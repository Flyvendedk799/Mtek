# Embedded product configurator

A complete, local-only sample storefront, built to exercise Mtek as an embedded application. It has a reusable seven-part chair, two independent static instances, typed website-to-scene inputs, and typed scene-to-website subscriptions. The original material-configurator and its pixel-oracle fixtures remain unchanged.

This is a demonstration, not a store. Prices are illustrative and there is no checkout, analytics, account, network service, or downloaded asset.

## Run

From the repository root with its pinned Rust and Node toolchains. The static-server command below also needs Python 3; an equivalent static HTTP server can serve the same project directory:

```sh
npm ci
npm run build
cargo run -p mtek-cli -- build --mode release examples/product-configurator
node node_modules/typescript/bin/tsc -p examples/product-configurator/host
python3 -m http.server 8000 --directory examples/product-configurator
```

Open http://localhost:8000/host/index.html in a WebGPU-capable browser. The host imports the generated `../dist/app.js`; serve the whole project so its generated relative resources resolve. `mtek dev` opens the generated scene-only page, not this storefront. After changing `.mtek` files, rerun the build command and reload the host page. HTML/CSS/host-JavaScript changes need only a reload; this static-server workflow does not hot-reload the storefront.

## Try it

- Choose fabric, timber, and quantity. The scene validates its product ranges, computes the illustrative quote, and publishes the confirmed values back to the page.
- Focus the preview and press Left/Right to change fabric or Space to toggle rotation. These are actual Mtek handlers, and the surrounding page updates through `onOutput`.
- Rotate your chair. The reference instance keeps its own colour, scale, state, and pose.
- Close and reopen the preview. GPU resources and output subscriptions are disposed; the last confirmed configuration is retained. A stale asynchronous mount cannot reopen a closed preview.
- Reset to the original configuration. Arrow keys in the form remain form controls; they do not also change the scene.

## Where the boundary lives

- `src/chair.mtek`: an imported `Chair` prefab. Root state drives child materials through bindings; child transforms are relative to the root.
- `src/main.mtek`: two instances and the product's scene state, keyboard interactions, range constraints, and quote calculation.
- `mtek.toml`: five `[host.inputs]` and seven `[host.outputs]`. Only explicitly exported state crosses the host boundary.
- `host/configurator.js`: checked JavaScript using the generated `Inputs` and `Outputs` declarations. It uses the production `setInput`/`onOutput` API and never reads debug scene state.
- `host/index.html` and `style.css`: a responsive, keyboard-accessible host page. The controls are disabled while the preview is unavailable.

An output subscription receives its initial snapshot after the next settled simulation frame (after rendering when the canvas has pixels), then changed values once per frame. Input changes queued by callbacks take effect on the following frame. `onOutput` returns an idempotent unsubscribe function. The preview does not need `options.test` or `app.debug` in normal use.

Assembly support is deliberately bounded: child entities work in statically declared prefab instances. Spawning a compound prefab and putting another prefab instance inside its assembly remain compile errors. Single-entity dynamic prefabs retain their existing behavior. The restriction on spawn/destroy inside helper functions is unchanged.

## Verification

```sh
npm run test:unit -w @mtek/codegen-tests -- product-configurator.test.ts
npm run test:browser -- --project=software specs/product/configurator.spec.ts
```

On Linux CI or a machine without a display, run the browser command with `MTEK_HEADED=1 xvfb-run -a npm run test:browser -- --project=software specs/product/configurator.spec.ts`. The virtual display is needed for the canvas screenshot assertion, not just GPU readback; see [the testing setup](../../spec/testing.md).

The codegen suite compiles this actual example in release mode, type-checks its actual host against generated declarations, and executes the generated scene to check independent assembly state, bindings, scene-originated interactions, quote arithmetic, and domain constraints. Browser global setup builds a separate test-mode copy and type-checks that host too. Its browser specs cover real rendering, inputs and outputs, keyboard isolation, reset, disposal, and repeated remounting. These browser tests require a usable WebGPU adapter; NOT-RUN is not a pass.
