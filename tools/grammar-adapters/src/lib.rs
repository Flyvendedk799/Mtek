//! The first grammar-constrained decoding adapter (`spec/ai-and-benchmarks.md`
//! section 3, decision 0073): llama.cpp at one pinned release, its GBNF
//! validator built from the same commit, and one pinned open-weights model.
//!
//! # The capability check (for the harness, M6-07)
//!
//! Before a constrained run the harness asks [`check_capability`] (or runs
//! `grammar-adapter check --format json`, which prints [`Capability::to_json`]
//! or [`Unavailable::to_json`]). It answers with a [`Capability`] only when it
//! has *seen* the backend work:
//!
//! 1. the install directory records the pinned release and commit
//!    (`install.json`, written by `fetch-backend.mjs`);
//! 2. the generator (`llama-completion`) runs and reports the pinned build
//!    and commit;
//! 3. the validator runs, loads the exported GBNF, accepts a valid probe
//!    module and rejects an invalid one;
//! 4. the model file has the pinned size and SHA-256;
//! 5. the generator loads the model and the grammar and produces a token
//!    under the grammar.
//!
//! Anything else is an [`Unavailable`] whose message starts with
//! [`UNAVAILABLE`] ("grammar-constrained mode unavailable") and names the
//! reason. There is no fallback: a caller that gets `Unavailable` must not run
//! the attempt unconstrained and call it constrained.
//!
//! [`generate`] runs one constrained generation with the checked capability,
//! with the caller's token limit (the grammar does not bound the length).

use std::fmt;
use std::io::Read as _;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use mtek_compiler::diagnostics::{Diagnostics, Severity};
use mtek_compiler::source::FileId;
use mtek_compiler::syntax::{lex_str, parse_module};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

/// The first words of every "unavailable" answer (`spec/ai-and-benchmarks.md`
/// section 3).
pub const UNAVAILABLE: &str = "grammar-constrained mode unavailable";

/// `pins.json`: the supported combination.
pub const PINS_JSON: &str = include_str!("../pins.json");

/// The default install directory: `$MTEK_GRAMMAR_ADAPTER_DIR`, else
/// `tools/grammar-adapters/.cache` of this checkout.
#[must_use]
pub fn default_install_dir() -> PathBuf {
    match std::env::var_os("MTEK_GRAMMAR_ADAPTER_DIR") {
        Some(dir) if !dir.is_empty() => PathBuf::from(dir),
        _ => Path::new(env!("CARGO_MANIFEST_DIR")).join(".cache"),
    }
}

/// The pins, read from [`PINS_JSON`].
#[derive(Clone, Debug)]
pub struct Pins {
    pub backend: String,
    pub release: String,
    pub commit: String,
    /// Strings the generator's `--version` output must contain.
    pub version_markers: Vec<String>,
    pub model_id: String,
    pub model_revision: String,
    pub model_sha256: String,
    pub model_size: u64,
}

impl Pins {
    /// # Errors
    ///
    /// When `pins.json` is not what this crate expects (a bug of the pins).
    pub fn load() -> Result<Pins, String> {
        let value: Value =
            serde_json::from_str(PINS_JSON).map_err(|e| format!("pins.json: {e}"))?;
        let text = |path: &[&str]| -> Result<String, String> {
            let mut v = &value;
            for key in path {
                v = v
                    .get(*key)
                    .ok_or_else(|| format!("pins.json has no {}", path.join(".")))?;
            }
            v.as_str()
                .map(str::to_owned)
                .ok_or_else(|| format!("pins.json: {} is not a string", path.join(".")))
        };
        let markers = value
            .get("versionMarkers")
            .and_then(Value::as_array)
            .ok_or("pins.json has no versionMarkers")?
            .iter()
            .filter_map(|m| m.as_str().map(str::to_owned))
            .collect();
        Ok(Pins {
            backend: text(&["backend"])?,
            release: text(&["release"])?,
            commit: text(&["commit"])?,
            version_markers: markers,
            model_id: text(&["model", "id"])?,
            model_revision: text(&["model", "revision"])?,
            model_sha256: text(&["model", "sha256"])?,
            model_size: value
                .pointer("/model/size")
                .and_then(Value::as_u64)
                .ok_or("pins.json has no model.size")?,
        })
    }
}

/// What `fetch-backend.mjs` prepared, as recorded in `install.json`.
#[derive(Clone, Debug, Default)]
pub struct Install {
    pub dir: PathBuf,
    pub validator: Option<PathBuf>,
    pub generator: Option<PathBuf>,
    pub model: Option<PathBuf>,
}

impl Install {
    /// The install in `dir`, if `install.json` there records the pinned
    /// release and commit.
    ///
    /// # Errors
    ///
    /// Why there is no usable install record.
    pub fn read(dir: &Path, pins: &Pins) -> Result<Install, String> {
        let path = dir.join("install.json");
        let text = std::fs::read_to_string(&path).map_err(|_| {
            format!(
                "the pinned {} {} is not installed in {} (run `node tools/grammar-adapters/fetch-backend.mjs --all`)",
                pins.backend,
                pins.release,
                dir.display()
            )
        })?;
        let value: Value = serde_json::from_str(&text)
            .map_err(|e| format!("{} is not valid JSON: {e}", path.display()))?;
        let release = value.get("release").and_then(Value::as_str);
        let commit = value.get("commit").and_then(Value::as_str);
        if release != Some(pins.release.as_str()) || commit != Some(pins.commit.as_str()) {
            return Err(format!(
                "{} records {} {} (commit {}), not the pinned {} (commit {})",
                path.display(),
                pins.backend,
                release.unwrap_or("?"),
                commit.unwrap_or("?"),
                pins.release,
                pins.commit
            ));
        }
        let file = |pointer: &str| {
            value
                .pointer(pointer)
                .and_then(Value::as_str)
                .map(|relative| dir.join(relative))
        };
        Ok(Install {
            dir: dir.to_owned(),
            validator: file("/validator/path"),
            generator: file("/backend/generator"),
            model: file("/model/path"),
        })
    }
}

// ----- running tools ------------------------------------------------------------------

/// The output of a finished process.
#[derive(Clone, Debug)]
pub struct Run {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
}

/// Run `command` with a time limit; it is killed when the limit passes.
///
/// # Errors
///
/// When the program cannot be started or runs out of time.
pub fn run_with_limit(command: &mut Command, limit: Duration) -> Result<Run, String> {
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("cannot start {command:?}: {e}"))?;
    let mut stdout = child.stdout.take();
    let mut stderr = child.stderr.take();
    let out_reader = std::thread::spawn(move || {
        let mut s = Vec::new();
        if let Some(pipe) = stdout.as_mut() {
            let _ = pipe.read_to_end(&mut s);
        }
        s
    });
    let err_reader = std::thread::spawn(move || {
        let mut s = Vec::new();
        if let Some(pipe) = stderr.as_mut() {
            let _ = pipe.read_to_end(&mut s);
        }
        s
    });
    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if start.elapsed() > limit => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!(
                    "{command:?} did not finish within {} s and was stopped",
                    limit.as_secs()
                ));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(5)),
            Err(e) => return Err(format!("waiting for {command:?}: {e}")),
        }
    };
    let stdout = out_reader.join().unwrap_or_default();
    let stderr = err_reader.join().unwrap_or_default();
    Ok(Run {
        success: status.success(),
        stdout: String::from_utf8_lossy(&stdout).into_owned(),
        stderr: String::from_utf8_lossy(&stderr).into_owned(),
    })
}

/// What the validator said about an input.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Verdict {
    Accepted,
    /// With the validator's error line ("Unexpected character … at position …").
    Rejected(String),
}

/// The pinned GBNF validator (`test-gbnf-validator` of llama.cpp).
#[derive(Clone, Debug)]
pub struct Validator {
    pub path: PathBuf,
}

impl Validator {
    /// Validate the file `input` against the grammar file `grammar`.
    ///
    /// The validator reads both files in text mode: on Windows `\r\n` reaches
    /// the grammar engine as `\n` (decision 0073 lists this).
    ///
    /// # Errors
    ///
    /// When the validator cannot run, cannot load the grammar, or answers
    /// something else than its two verdicts.
    pub fn validate_file(&self, grammar: &Path, input: &Path) -> Result<Verdict, String> {
        let run = run_with_limit(
            Command::new(&self.path).arg(grammar).arg(input),
            Duration::from_secs(120),
        )?;
        if run.stdout.contains("Input string is valid according to the grammar.") {
            return Ok(Verdict::Accepted);
        }
        if run.stdout.contains("Input string is invalid according to the grammar.") {
            let line = run
                .stdout
                .lines()
                .find(|l| l.starts_with("Error:"))
                .unwrap_or("Error: (none)")
                .to_owned();
            return Ok(Verdict::Rejected(line));
        }
        Err(format!(
            "the validator gave no verdict (success {}): {}{}",
            run.success,
            run.stdout.trim(),
            run.stderr.trim()
        ))
    }
}

/// A scratch directory under the system temporary directory, removed on drop.
#[derive(Debug)]
pub struct Scratch(pub PathBuf);

impl Scratch {
    /// # Errors
    ///
    /// When the directory cannot be created.
    pub fn new(name: &str) -> Result<Scratch, String> {
        let dir = std::env::temp_dir().join(format!(
            "mtek-grammar-adapters-{}-{name}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
        Ok(Scratch(dir))
    }

    /// Write `content` to `name` in the directory.
    ///
    /// # Errors
    ///
    /// When the file cannot be written.
    pub fn write(&self, name: &str, content: &[u8]) -> Result<PathBuf, String> {
        let path = self.0.join(name);
        std::fs::write(&path, content).map_err(|e| format!("{}: {e}", path.display()))?;
        Ok(path)
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = std::fs::File::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1 << 20];
    loop {
        let n = file
            .read(&mut buffer)
            .map_err(|e| format!("{}: {e}", path.display()))?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

// ----- the compiler's verdict ------------------------------------------------------------

/// What the compiler's lexer and parser say about a text.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct CompilerVerdict {
    /// The codes of the error diagnostics, in order (`E1001`).
    pub errors: Vec<String>,
}

/// Lex and parse `text` as one module.
#[must_use]
pub fn compiler_verdict(text: &str) -> CompilerVerdict {
    let mut lexed = lex_str(FileId(0), text);
    let mut sink = Diagnostics::new();
    lexed.report_into(&mut sink);
    let _ = parse_module(text, &lexed.tokens, &lexed.trivia, &mut sink);
    let report = sink.finish();
    CompilerVerdict {
        errors: report
            .diagnostics
            .iter()
            .filter(|d| d.severity == Severity::Error)
            .map(|d| d.code.short().to_owned())
            .collect(),
    }
}

/// The codes the lexer and parser report for text that the reference grammar
/// itself rejects (lexical and syntax codes, decision 0073).
pub const GRAMMAR_CODES: [&str; 20] = [
    "E0002", "E0003", "E0005", "E0006", "E0010", "E0013", "E0020", "E0021", "E0022", "E0023",
    "E0024", "E0025", "E1001", "E1002", "E1003", "E1004", "E1010", "E1011", "E1901", "E4901",
];

/// The codes the lexer and parser report for `[S: …]` restrictions and
/// placement rules on text that the reference grammar accepts.
pub const RESTRICTION_CODES: [&str; 3] = ["E0011", "E1020", "E1030"];

/// What the grammar should do with a text, by the compiler's verdict.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Expectation {
    Accept,
    Reject,
    /// Only codes that can stand for either (`E1040`: a member in the wrong
    /// body is sometimes grammatical; `E1050`: the parser skips what is
    /// nested too deep without reading it).
    Undetermined,
}

impl CompilerVerdict {
    /// The expectation for the grammar.
    #[must_use]
    pub fn expectation(&self) -> Expectation {
        if self.errors.iter().any(|c| GRAMMAR_CODES.contains(&c.as_str())) {
            Expectation::Reject
        } else if self
            .errors
            .iter()
            .all(|c| RESTRICTION_CODES.contains(&c.as_str()))
        {
            Expectation::Accept
        } else {
            Expectation::Undetermined
        }
    }
}

// ----- the capability check ---------------------------------------------------------------

/// The pinned combination, seen working.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Capability {
    pub backend: String,
    pub release: String,
    pub commit: String,
    pub generator: PathBuf,
    pub generator_version: String,
    pub validator: PathBuf,
    pub model: PathBuf,
    pub model_id: String,
    pub model_revision: String,
    pub model_sha256: String,
    /// SHA-256 of the GBNF text the check loaded.
    pub grammar_sha256: String,
}

impl Capability {
    /// The `grammar-adapter check --format json` report.
    #[must_use]
    pub fn to_json(&self) -> Value {
        json!({
            "status": "available",
            "mode": "constrained",
            "backend": self.backend,
            "release": self.release,
            "commit": self.commit,
            "generator": self.generator.display().to_string(),
            "generatorVersion": self.generator_version,
            "validator": self.validator.display().to_string(),
            "model": {
                "id": self.model_id,
                "revision": self.model_revision,
                "path": self.model.display().to_string(),
                "sha256": self.model_sha256,
            },
            "grammar": { "root": mtek_compiler::syntax::GBNF_ROOT, "sha256": self.grammar_sha256 },
        })
    }
}

/// Grammar-constrained mode is not available, and why.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Unavailable {
    pub reason: String,
}

impl Unavailable {
    fn new(reason: impl Into<String>) -> Self {
        Unavailable {
            reason: reason.into(),
        }
    }

    /// The `grammar-adapter check --format json` report.
    #[must_use]
    pub fn to_json(&self) -> Value {
        json!({ "status": "unavailable", "message": self.to_string(), "reason": self.reason })
    }
}

impl fmt::Display for Unavailable {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{UNAVAILABLE}: {}", self.reason)
    }
}

impl std::error::Error for Unavailable {}

/// A valid module and an invalid one: the grammar must tell them apart.
const PROBE_VALID: &str = "scene Probe {\n    camera Main { position: vec3(0.0, 0.0, 5.0); }\n}\n";
const PROBE_INVALID: &str = "scene Probe {\n    camera Main { position vec3(0.0); }\n}\n";

/// Check that grammar-constrained generation works with the pinned
/// combination installed in `dir` (see the crate documentation).
///
/// # Errors
///
/// [`Unavailable`] with the reason whenever any step does not work.
pub fn check_capability(dir: &Path) -> Result<Capability, Unavailable> {
    let pins = Pins::load().map_err(Unavailable::new)?;
    let install = Install::read(dir, &pins).map_err(Unavailable::new)?;
    let grammar = mtek_compiler::syntax::gbnf()
        .map_err(|e| Unavailable::new(format!("the GBNF export failed: {e}")))?;

    // 2. The generator is the pinned build.
    let generator = install
        .generator
        .clone()
        .filter(|p| p.is_file())
        .ok_or_else(|| {
            Unavailable::new(format!(
                "the llama.cpp generator is not installed in {} (run `node tools/grammar-adapters/fetch-backend.mjs --backend`)",
                dir.display()
            ))
        })?;
    let version = run_with_limit(
        Command::new(&generator).arg("--version"),
        Duration::from_secs(60),
    )
    .map_err(Unavailable::new)?;
    let version_text = format!("{}{}", version.stdout, version.stderr);
    let version_line = version_text
        .lines()
        .find(|l| l.contains("version"))
        .unwrap_or("")
        .trim()
        .to_owned();
    if !pins
        .version_markers
        .iter()
        .all(|m| version_text.contains(m.as_str()))
    {
        return Err(Unavailable::new(format!(
            "{} reports {version_line:?}, not the pinned {} ({})",
            generator.display(),
            pins.release,
            pins.version_markers.join(", ")
        )));
    }

    // 3. The validator loads the grammar and tells a valid probe from an invalid one.
    let validator = install
        .validator
        .clone()
        .filter(|p| p.is_file())
        .ok_or_else(|| {
            Unavailable::new(format!(
                "the GBNF validator is not built in {} (run `node tools/grammar-adapters/fetch-backend.mjs --validator`)",
                dir.display()
            ))
        })?;
    let scratch = Scratch::new("check").map_err(Unavailable::new)?;
    let grammar_path = scratch
        .write("mtek.gbnf", grammar.as_bytes())
        .map_err(Unavailable::new)?;
    let validator = Validator { path: validator };
    for (probe, wanted) in [(PROBE_VALID, true), (PROBE_INVALID, false)] {
        let input = scratch
            .write("probe.mtek", probe.as_bytes())
            .map_err(Unavailable::new)?;
        let verdict = validator
            .validate_file(&grammar_path, &input)
            .map_err(|e| Unavailable::new(format!("the grammar does not load in the pinned validator: {e}")))?;
        if (verdict == Verdict::Accepted) != wanted {
            return Err(Unavailable::new(format!(
                "the pinned validator {} the {} probe module: the grammar is not enforced as exported",
                if wanted { "rejects" } else { "accepts" },
                if wanted { "valid" } else { "invalid" }
            )));
        }
    }

    // 4. The model is the pinned file.
    let model = install
        .model
        .clone()
        .filter(|p| p.is_file())
        .ok_or_else(|| {
            Unavailable::new(format!(
                "the pinned model {} is not installed in {} (run `node tools/grammar-adapters/fetch-backend.mjs --model`)",
                pins.model_id,
                dir.display()
            ))
        })?;
    let size = std::fs::metadata(&model).map(|m| m.len()).unwrap_or(0);
    if size != pins.model_size {
        return Err(Unavailable::new(format!(
            "{} has {size} bytes, the pinned model has {}",
            model.display(),
            pins.model_size
        )));
    }
    let model_sha = sha256_file(&model).map_err(Unavailable::new)?;
    if model_sha != pins.model_sha256 {
        return Err(Unavailable::new(format!(
            "{} has SHA-256 {model_sha}, the pinned model has {}",
            model.display(),
            pins.model_sha256
        )));
    }

    let capability = Capability {
        backend: pins.backend.clone(),
        release: pins.release.clone(),
        commit: pins.commit.clone(),
        generator,
        generator_version: version_line,
        validator: validator.path.clone(),
        model,
        model_id: pins.model_id.clone(),
        model_revision: pins.model_revision.clone(),
        model_sha256: model_sha,
        grammar_sha256: sha256_hex(grammar.as_bytes()),
    };

    // 5. The generator loads the model and the grammar and samples under it.
    let probe = generate(&capability, &grammar, "scene", 4).map_err(|e| {
        Unavailable::new(format!("the generator did not run with the grammar: {e}"))
    })?;
    if probe.text.is_empty() && probe.tokens == 0 {
        return Err(Unavailable::new(
            "the generator produced nothing under the grammar".to_owned(),
        ));
    }
    Ok(capability)
}

/// One constrained generation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Generation {
    /// The generated text (without the prompt).
    pub text: String,
    /// The decode runs llama.cpp reported after the first sampled token (0
    /// if it did not say); informational.
    pub tokens: u64,
    /// The generator did not end with an end-of-generation token (which the
    /// grammar allows only where the module is complete): it stopped at the
    /// token limit. `truncated` is a failure state
    /// (`spec/ai-and-benchmarks.md` section 1), even if the text parses.
    pub truncated: bool,
    /// The generator's log (stderr), for the record.
    pub log: String,
}

/// Generate up to `max_tokens` tokens after `prompt` under `grammar` with the
/// checked combination: greedy (temperature 0), seed 0, CPU only, the
/// prompt as raw text (no chat template).
///
/// # Errors
///
/// When the generator fails or runs out of time.
pub fn generate(
    capability: &Capability,
    grammar: &str,
    prompt: &str,
    max_tokens: u32,
) -> Result<Generation, String> {
    let scratch = Scratch::new("generate")?;
    let grammar_path = scratch.write("mtek.gbnf", grammar.as_bytes())?;
    let prompt_path = scratch.write("prompt.txt", prompt.as_bytes())?;
    let run = run_with_limit(
        Command::new(&capability.generator)
            .arg("-m")
            .arg(&capability.model)
            .arg("-f")
            .arg(&prompt_path)
            .arg("--grammar-file")
            .arg(&grammar_path)
            .args(["-n", &max_tokens.to_string()])
            .args(["--temp", "0", "--seed", "0", "-ngl", "0", "-c", "4096"])
            .args(["-no-cnv", "--no-display-prompt", "--no-warmup"]),
        Duration::from_secs(1800),
    )?;
    if !run.success {
        let tail: Vec<&str> = run.stderr.lines().rev().take(8).collect();
        return Err(format!(
            "the generator failed: {}",
            tail.into_iter().rev().collect::<Vec<_>>().join(" | ")
        ));
    }
    // llama-completion ends its output with " [end of text]" when the model
    // produced an end-of-generation token, which the grammar sampler allows
    // only where the grammar accepts; otherwise it stopped at the limit.
    let (text, ended) = split_end_of_text(&run.stdout);
    Ok(Generation {
        truncated: !ended,
        text,
        tokens: generated_tokens(&run.stderr),
        log: run.stderr,
    })
}

const END_OF_TEXT: &str = " [end of text]";

fn split_end_of_text(stdout: &str) -> (String, bool) {
    let trimmed = stdout.trim_end_matches(['\n', '\r']);
    match trimmed.strip_suffix(END_OF_TEXT) {
        Some(text) => (text.to_owned(), true),
        None => (stdout.to_owned(), false),
    }
}

/// The number of generated tokens from llama.cpp's timing log
/// (`eval time = … / N runs`).
fn generated_tokens(log: &str) -> u64 {
    log.lines()
        .filter(|l| l.contains("eval time") && !l.contains("prompt eval time"))
        .find_map(|l| {
            let runs = l.split('/').nth(1)?;
            runs.split_whitespace().next()?.parse().ok()
        })
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_pins_load() {
        let pins = Pins::load().expect("pins.json");
        assert_eq!(pins.backend, "llama.cpp");
        assert_eq!(pins.commit.len(), 40);
        assert_eq!(pins.model_sha256.len(), 64);
        assert!(!pins.version_markers.is_empty());
    }

    #[test]
    fn a_missing_install_is_unavailable_with_the_message() {
        let scratch = Scratch::new("missing").expect("scratch");
        let error = check_capability(&scratch.0).expect_err("nothing is installed");
        assert!(error.to_string().starts_with("grammar-constrained mode unavailable: "));
        assert!(error.reason.contains("not installed"), "{}", error.reason);
        let json = error.to_json();
        assert_eq!(json["status"], "unavailable");
        assert!(json["message"]
            .as_str()
            .is_some_and(|m| m.starts_with(UNAVAILABLE)));
    }

    #[test]
    fn a_stale_install_is_unavailable() {
        let scratch = Scratch::new("stale").expect("scratch");
        scratch
            .write(
                "install.json",
                br#"{ "release": "b1", "commit": "0000000000000000000000000000000000000000" }"#,
            )
            .expect("write");
        let error = check_capability(&scratch.0).expect_err("stale");
        assert!(error.reason.contains("not the pinned"), "{}", error.reason);
    }

    #[test]
    fn an_install_without_binaries_is_unavailable() {
        let pins = Pins::load().expect("pins");
        let scratch = Scratch::new("empty").expect("scratch");
        let record = json!({ "release": pins.release, "commit": pins.commit });
        scratch
            .write("install.json", record.to_string().as_bytes())
            .expect("write");
        let error = check_capability(&scratch.0).expect_err("no generator");
        assert!(error.reason.contains("generator is not installed"), "{}", error.reason);
    }

    #[test]
    fn a_generator_of_another_version_is_unavailable() {
        // Any program that runs and does not print the pinned build: the
        // current test binary itself, with `--version` (an unknown filter).
        let pins = Pins::load().expect("pins");
        let scratch = Scratch::new("version").expect("scratch");
        let exe = std::env::current_exe().expect("exe");
        let record = json!({
            "release": pins.release, "commit": pins.commit,
            "backend": { "generator": exe.display().to_string() },
        });
        scratch
            .write("install.json", record.to_string().as_bytes())
            .expect("write");
        let error = check_capability(&scratch.0).expect_err("wrong version");
        assert!(error.reason.contains("not the pinned"), "{}", error.reason);
    }

    #[test]
    fn verdict_expectations_follow_the_codes() {
        let v = |codes: &[&str]| CompilerVerdict {
            errors: codes.iter().map(|c| (*c).to_owned()).collect(),
        };
        assert_eq!(v(&[]).expectation(), Expectation::Accept);
        assert_eq!(v(&["E1020"]).expectation(), Expectation::Accept);
        assert_eq!(v(&["E1001"]).expectation(), Expectation::Reject);
        assert_eq!(v(&["E1040", "E1003"]).expectation(), Expectation::Reject);
        assert_eq!(v(&["E1040"]).expectation(), Expectation::Undetermined);
        assert_eq!(v(&["E1050"]).expectation(), Expectation::Undetermined);
    }

    #[test]
    fn the_token_count_is_read_from_the_timing_log() {
        let log = "llama_perf_context_print: prompt eval time =  10.0 ms /  3 tokens\nllama_perf_context_print:        eval time =  50.0 ms /    17 runs   (  2.9 ms per token)\n";
        assert_eq!(generated_tokens(log), 17);
        assert_eq!(generated_tokens(""), 0);
    }

    #[test]
    fn the_end_of_text_marker_separates_complete_from_truncated() {
        assert_eq!(
            split_end_of_text("scene A {}\n [end of text]\n"),
            ("scene A {}\n".to_owned(), true)
        );
        assert_eq!(split_end_of_text("scene A {"), ("scene A {".to_owned(), false));
    }

    #[test]
    fn the_compiler_verdict_lexes_and_parses() {
        assert_eq!(compiler_verdict("fn f() {}").errors, Vec::<String>::new());
        assert_eq!(compiler_verdict("fn f() {").expectation(), Expectation::Reject);
    }
}
