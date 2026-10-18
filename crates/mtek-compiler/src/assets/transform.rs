//! World transforms of glTF nodes and their decomposition into the translation, rotation and
//! scale of an Mtek entity (`spec/assets.md` section 2.1, `E7013`).
//!
//! The world matrix is the product of the local matrices from the scene root to the node,
//! computed in `f64`. An entity transform is position, rotation and a per-axis scale, so a
//! matrix is representable exactly when it is affine, has three non-zero column lengths, has
//! pairwise orthogonal columns (no shear) and a rotation of determinant +1 (no mirror).

use super::glb::{GlbFile, LocalTransform};

/// Columns are orthogonal when `|a·b| <= SHEAR_TOLERANCE * |a||b|`; the last row is `0 0 0 1`
/// within `AFFINE_TOLERANCE`. Exporters round matrices to about seven digits.
const SHEAR_TOLERANCE: f64 = 1e-4;
const AFFINE_TOLERANCE: f64 = 1e-6;
/// A column shorter than this is a zero scale.
const MIN_SCALE: f64 = 1e-9;

/// The decomposed world transform of a node.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Trs {
    pub translation: [f32; 3],
    /// `(x, y, z, w)`, unit length, `w >= 0`.
    pub rotation: [f32; 4],
    pub scale: [f32; 3],
}

type Mat = [[f64; 4]; 4];

const IDENTITY: Mat = [
    [1.0, 0.0, 0.0, 0.0],
    [0.0, 1.0, 0.0, 0.0],
    [0.0, 0.0, 1.0, 0.0],
    [0.0, 0.0, 0.0, 1.0],
];

/// `a * b` for column-major matrices (`m[column][row]`).
fn multiply(a: &Mat, b: &Mat) -> Mat {
    let mut out = [[0.0; 4]; 4];
    for (column, out_column) in out.iter_mut().enumerate() {
        for (row, cell) in out_column.iter_mut().enumerate() {
            *cell = (0..4)
                .map(|k| {
                    let left = a.get(k).and_then(|c| c.get(row)).copied().unwrap_or(0.0);
                    let right = b.get(column).and_then(|c| c.get(k)).copied().unwrap_or(0.0);
                    left * right
                })
                .sum();
        }
    }
    out
}

fn local_matrix(local: &LocalTransform) -> Result<Mat, String> {
    match local {
        LocalTransform::Matrix(values) => {
            let mut m = IDENTITY;
            for (index, value) in values.iter().enumerate() {
                if let Some(cell) = m.get_mut(index / 4).and_then(|c| c.get_mut(index % 4)) {
                    *cell = f64::from(*value);
                }
            }
            Ok(m)
        }
        LocalTransform::Trs { t, r, s } => {
            let [x, y, z, w] = r.map(f64::from);
            let length = (x * x + y * y + z * z + w * w).sqrt();
            if !length.is_finite() || length < 1e-12 {
                return Err("a rotation quaternion has length zero".into());
            }
            let (x, y, z, w) = (x / length, y / length, z / length, w / length);
            let [sx, sy, sz] = s.map(f64::from);
            let [tx, ty, tz] = t.map(f64::from);
            Ok([
                [
                    (1.0 - 2.0 * (y * y + z * z)) * sx,
                    (2.0 * (x * y + z * w)) * sx,
                    (2.0 * (x * z - y * w)) * sx,
                    0.0,
                ],
                [
                    (2.0 * (x * y - z * w)) * sy,
                    (1.0 - 2.0 * (x * x + z * z)) * sy,
                    (2.0 * (y * z + x * w)) * sy,
                    0.0,
                ],
                [
                    (2.0 * (x * z + y * w)) * sz,
                    (2.0 * (y * z - x * w)) * sz,
                    (1.0 - 2.0 * (x * x + y * y)) * sz,
                    0.0,
                ],
                [tx, ty, tz, 1.0],
            ])
        }
        LocalTransform::Conflict => {
            Err("it has both a `matrix` and translation, rotation or scale".into())
        }
    }
}

/// The nodes from a root of `scene` down to `target`, if `target` is below one of its roots.
fn path_to(file: &GlbFile, scene: usize, target: usize) -> Option<Vec<usize>> {
    let roots = file.scenes.get(scene)?;
    // Depth-first with an explicit stack; `seen` guards against a cyclic hierarchy.
    let mut seen = vec![false; file.nodes.len()];
    let mut stack: Vec<(usize, Vec<usize>)> = roots.iter().rev().map(|r| (*r, vec![*r])).collect();
    while let Some((node, path)) = stack.pop() {
        if node == target {
            return Some(path);
        }
        let flag = seen.get_mut(node)?;
        if *flag {
            continue;
        }
        *flag = true;
        for child in file.nodes.get(node)?.children.iter().rev() {
            let mut next = path.clone();
            next.push(*child);
            stack.push((*child, next));
        }
    }
    None
}

/// Whether `node` is part of the default scene's hierarchy.
#[must_use]
pub fn in_default_scene(file: &GlbFile, node: usize) -> bool {
    file.default_scene
        .and_then(|scene| path_to(file, scene, node))
        .is_some()
}

/// The world transform of `node` in the default scene as translation, rotation and scale.
///
/// # Errors
/// The reason, as a clause ("it has shear …"), when the transform cannot be an entity's.
pub fn node_world_trs(file: &GlbFile, node: usize) -> Result<Trs, String> {
    let path = file
        .default_scene
        .and_then(|scene| path_to(file, scene, node))
        .ok_or_else(|| "it is not part of the default scene".to_owned())?;
    let mut world = IDENTITY;
    for index in path {
        let local = file
            .nodes
            .get(index)
            .ok_or_else(|| "the hierarchy refers to a missing node".to_owned())?;
        world = multiply(&world, &local_matrix(&local.local)?);
    }
    decompose(&world)
}

fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn decompose(m: &Mat) -> Result<Trs, String> {
    let column = |c: usize| -> [f64; 3] {
        let col = m.get(c).copied().unwrap_or([0.0; 4]);
        [col[0], col[1], col[2]]
    };
    let at = |c: usize, r: usize| m.get(c).and_then(|col| col.get(r)).copied().unwrap_or(0.0);
    if at(0, 3).abs() > AFFINE_TOLERANCE
        || at(1, 3).abs() > AFFINE_TOLERANCE
        || at(2, 3).abs() > AFFINE_TOLERANCE
        || (at(3, 3) - 1.0).abs() > AFFINE_TOLERANCE
    {
        return Err("its world matrix is not affine (the last row is not 0 0 0 1)".into());
    }
    let columns = [column(0), column(1), column(2)];
    let lengths = columns.map(|c| dot(c, c).sqrt());
    if lengths.iter().any(|l| !l.is_finite()) {
        return Err("its world matrix is not finite".into());
    }
    if lengths.iter().any(|l| *l < MIN_SCALE) {
        return Err("its world matrix has a scale of zero on an axis".into());
    }
    let axes: Vec<[f64; 3]> = columns
        .iter()
        .zip(lengths)
        .map(|(c, l)| [c[0] / l, c[1] / l, c[2] / l])
        .collect();
    let (a0, a1, a2) = (axes[0], axes[1], axes[2]);
    for (first, second, names) in [(a0, a1, "X and Y"), (a0, a2, "X and Z"), (a1, a2, "Y and Z")] {
        if dot(first, second).abs() > SHEAR_TOLERANCE {
            return Err(format!(
                "its world matrix has shear (the {names} axes are not perpendicular), usually from a non-uniform scale below a rotated parent"
            ));
        }
    }
    if dot(cross(a0, a1), a2) < 0.0 {
        return Err("its world matrix mirrors the model (a negative scale)".into());
    }
    // Rotation matrix with the axes as columns: r[row][column].
    let r = |row: usize, col: usize| -> f64 {
        match col {
            0 => a0[row],
            1 => a1[row],
            _ => a2[row],
        }
    };
    let trace = r(0, 0) + r(1, 1) + r(2, 2);
    let (x, y, z, w) = if trace > 0.0 {
        let s = (trace + 1.0).sqrt() * 2.0;
        (
            (r(2, 1) - r(1, 2)) / s,
            (r(0, 2) - r(2, 0)) / s,
            (r(1, 0) - r(0, 1)) / s,
            0.25 * s,
        )
    } else if r(0, 0) > r(1, 1) && r(0, 0) > r(2, 2) {
        let s = (1.0 + r(0, 0) - r(1, 1) - r(2, 2)).sqrt() * 2.0;
        (
            0.25 * s,
            (r(0, 1) + r(1, 0)) / s,
            (r(0, 2) + r(2, 0)) / s,
            (r(2, 1) - r(1, 2)) / s,
        )
    } else if r(1, 1) > r(2, 2) {
        let s = (1.0 + r(1, 1) - r(0, 0) - r(2, 2)).sqrt() * 2.0;
        (
            (r(0, 1) + r(1, 0)) / s,
            0.25 * s,
            (r(1, 2) + r(2, 1)) / s,
            (r(0, 2) - r(2, 0)) / s,
        )
    } else {
        let s = (1.0 + r(2, 2) - r(0, 0) - r(1, 1)).sqrt() * 2.0;
        (
            (r(0, 2) + r(2, 0)) / s,
            (r(1, 2) + r(2, 1)) / s,
            0.25 * s,
            (r(1, 0) - r(0, 1)) / s,
        )
    };
    let norm = (x * x + y * y + z * z + w * w).sqrt();
    let sign = if w < 0.0 { -1.0 } else { 1.0 };
    let rotation = [x, y, z, w].map(|v| (v / norm * sign) as f32);
    let translation = [at(3, 0), at(3, 1), at(3, 2)].map(|v| v as f32);
    let scale = lengths.map(|v| v as f32);
    if rotation
        .iter()
        .chain(&translation)
        .chain(&scale)
        .any(|v| !v.is_finite())
    {
        return Err("its world transform is not finite".into());
    }
    Ok(Trs {
        translation,
        rotation,
        scale,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(nodes: Vec<(Vec<usize>, LocalTransform)>) -> GlbFile {
        GlbFile {
            path: "m.glb".into(),
            file_bytes: 0,
            sha256: String::new(),
            bin: Vec::new(),
            meshes: Vec::new(),
            materials: Vec::new(),
            images: Vec::new(),
            nodes: nodes
                .into_iter()
                .map(|(children, local)| super::super::glb::GlbNode {
                    name: None,
                    children,
                    local,
                })
                .collect(),
            scenes: vec![vec![0]],
            default_scene: Some(0),
        }
    }

    fn trs(t: [f32; 3], r: [f32; 4], s: [f32; 3]) -> LocalTransform {
        LocalTransform::Trs { t, r, s }
    }

    #[test]
    fn translation_and_scale_compose_down_the_hierarchy() {
        let f = file(vec![
            (vec![1], trs([1.0, 2.0, 3.0], [0.0, 0.0, 0.0, 1.0], [2.0, 2.0, 2.0])),
            (vec![], trs([1.0, 0.0, 0.0], [0.0, 0.0, 0.0, 1.0], [1.0, 3.0, 1.0])),
        ]);
        let world = node_world_trs(&f, 1).unwrap();
        assert_eq!(world.translation, [3.0, 2.0, 3.0]);
        assert_eq!(world.scale, [2.0, 6.0, 2.0]);
        assert_eq!(world.rotation, [0.0, 0.0, 0.0, 1.0]);
    }

    #[test]
    fn a_quarter_turn_round_trips() {
        let h = std::f32::consts::FRAC_1_SQRT_2;
        let f = file(vec![(vec![], trs([0.0; 3], [0.0, h, 0.0, h], [1.0; 3]))]);
        let world = node_world_trs(&f, 0).unwrap();
        for (a, b) in world.rotation.iter().zip([0.0, h, 0.0, h]) {
            assert!((a - b).abs() < 1e-6, "{:?}", world.rotation);
        }
    }

    #[test]
    fn a_matrix_node_decomposes() {
        #[rustfmt::skip]
        let m = [
            2.0, 0.0, 0.0, 0.0,
            0.0, 3.0, 0.0, 0.0,
            0.0, 0.0, 4.0, 0.0,
            5.0, 6.0, 7.0, 1.0,
        ];
        let f = file(vec![(vec![], LocalTransform::Matrix(m))]);
        let world = node_world_trs(&f, 0).unwrap();
        assert_eq!(world.translation, [5.0, 6.0, 7.0]);
        assert_eq!(world.scale, [2.0, 3.0, 4.0]);
    }

    #[test]
    fn shear_mirror_zero_scale_and_conflicts_are_not_representable() {
        let q = std::f32::consts::FRAC_1_SQRT_2;
        // A non-uniform scale below a rotated parent shears.
        let sheared = file(vec![
            (vec![1], trs([0.0; 3], [0.0, 0.0, q, q], [1.0; 3])),
            (vec![], trs([0.0; 3], [0.0, 0.0, 0.0, 1.0], [1.0, 2.0, 1.0])),
        ]);
        assert!(node_world_trs(&sheared, 1).unwrap_err().contains("shear"));
        let mirrored = file(vec![(vec![], trs([0.0; 3], [0.0, 0.0, 0.0, 1.0], [-1.0, 1.0, 1.0]))]);
        assert!(node_world_trs(&mirrored, 0).unwrap_err().contains("mirror"));
        let flat = file(vec![(vec![], trs([0.0; 3], [0.0, 0.0, 0.0, 1.0], [0.0, 1.0, 1.0]))]);
        assert!(node_world_trs(&flat, 0).unwrap_err().contains("zero"));
        let both = file(vec![(vec![], LocalTransform::Conflict)]);
        assert!(node_world_trs(&both, 0).unwrap_err().contains("both"));
        let missing = file(vec![(vec![], trs([0.0; 3], [0.0, 0.0, 0.0, 1.0], [1.0; 3]))]);
        assert!(node_world_trs(&missing, 5).unwrap_err().contains("default scene"));
    }
}
