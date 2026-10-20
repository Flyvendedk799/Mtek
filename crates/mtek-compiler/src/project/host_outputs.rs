//! Typed, read-only scene-state exports to the embedding host.
use std::collections::{BTreeMap, BTreeSet};

use crate::diagnostics::Diagnostics;
use crate::package::manifest::{HostInputTarget, HostOutput};
use crate::types::CheckedScene;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResolvedHostOutput {
    pub name: String,
    pub state_name: String,
    pub ty: String,
    pub ts_type: String,
}

pub fn validate_host_outputs(
    outputs: &BTreeMap<String, String>,
    scene: &CheckedScene,
    sink: &mut Diagnostics,
) -> Vec<ResolvedHostOutput> {
    super::host_inputs::validate_host_ports(outputs, scene, &BTreeSet::new(), "output", sink)
        .into_iter()
        .map(|port| ResolvedHostOutput {
            name: port.name,
            state_name: port.state_name,
            ts_type: match port.ty.as_str() {
                "vec2" => "readonly [number, number]",
                "vec3" => "readonly [number, number, number]",
                "vec4" | "color" => "readonly [number, number, number, number]",
                _ => &port.ts_type,
            }
            .to_owned(),
            ty: port.ty,
        })
        .collect()
}

impl ResolvedHostOutput {
    #[must_use]
    pub fn to_manifest(&self) -> HostOutput {
        HostOutput {
            name: self.name.clone(),
            source: HostInputTarget {
                kind: "state".to_owned(),
                name: self.state_name.clone(),
            },
            ty: self.ty.clone(),
        }
    }
}
