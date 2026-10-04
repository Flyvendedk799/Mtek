//! The operator typing table of `spec/language.md` section 6.2, for the
//! operators this build implements (unary `-` and `+ - * /`; the others are
//! gated, decision 0026).

use super::ty::Ty;
use super::value::ArithOp;

/// One row of the table: `lhs op rhs` has type `result` for every `op` of
/// `ops`.
struct Row {
    ops: &'static [ArithOp],
    lhs: Ty,
    rhs: Ty,
    result: Ty,
}

const ALL: &[ArithOp] = &[ArithOp::Add, ArithOp::Sub, ArithOp::Mul, ArithOp::Div];
const SCALE: &[ArithOp] = &[ArithOp::Mul, ArithOp::Div];
const MUL: &[ArithOp] = &[ArithOp::Mul];

const fn row(ops: &'static [ArithOp], lhs: Ty, rhs: Ty, result: Ty) -> Row {
    Row {
        ops,
        lhs,
        rhs,
        result,
    }
}

/// Section 6.2, transcribed: same-typed scalars; same-dimension vectors
/// component-wise; vector times or divided by `f32`, `f32` times vector;
/// `mat4 * mat4`, `mat4 * vec4`; `quat * quat` (Hamilton product) and
/// `quat * vec3` (rotation).
const ROWS: &[Row] = &[
    row(ALL, Ty::F32, Ty::F32, Ty::F32),
    row(ALL, Ty::I32, Ty::I32, Ty::I32),
    row(ALL, Ty::U32, Ty::U32, Ty::U32),
    row(ALL, Ty::Vec2, Ty::Vec2, Ty::Vec2),
    row(ALL, Ty::Vec3, Ty::Vec3, Ty::Vec3),
    row(ALL, Ty::Vec4, Ty::Vec4, Ty::Vec4),
    row(SCALE, Ty::Vec2, Ty::F32, Ty::Vec2),
    row(SCALE, Ty::Vec3, Ty::F32, Ty::Vec3),
    row(SCALE, Ty::Vec4, Ty::F32, Ty::Vec4),
    row(MUL, Ty::F32, Ty::Vec2, Ty::Vec2),
    row(MUL, Ty::F32, Ty::Vec3, Ty::Vec3),
    row(MUL, Ty::F32, Ty::Vec4, Ty::Vec4),
    row(MUL, Ty::Mat4, Ty::Mat4, Ty::Mat4),
    row(MUL, Ty::Mat4, Ty::Vec4, Ty::Vec4),
    row(MUL, Ty::Quat, Ty::Quat, Ty::Quat),
    row(MUL, Ty::Quat, Ty::Vec3, Ty::Vec3),
];

/// The result type of `lhs op rhs`, or `None` if the table has no such row.
#[must_use]
pub fn arithmetic_result(op: ArithOp, lhs: Ty, rhs: Ty) -> Option<Ty> {
    ROWS.iter()
        .find(|r| r.ops.contains(&op) && r.lhs == lhs && r.rhs == rhs)
        .map(|r| r.result)
}

/// The type an untyped literal operand adopts next to an operand of type
/// `other` (section 6.6: a literal adopts the type its context requires).
/// `literal_is_rhs` tells on which side the literal stands. `None` means the
/// context requires nothing the literal could become, so it keeps its
/// default type (and the operator table then decides).
#[must_use]
pub fn literal_operand_type(op: ArithOp, other: Ty, literal_is_rhs: bool) -> Option<Ty> {
    let candidates = [Ty::F32, Ty::I32, Ty::U32];
    candidates.into_iter().find(|&scalar| {
        let (lhs, rhs) = if literal_is_rhs {
            (other, scalar)
        } else {
            (scalar, other)
        };
        arithmetic_result(op, lhs, rhs).is_some()
    })
}

/// The type of `-operand`: `f32`, `i32` and vectors (section 6.2).
#[must_use]
pub fn negation_result(operand: Ty) -> Option<Ty> {
    matches!(operand, Ty::F32 | Ty::I32 | Ty::Vec2 | Ty::Vec3 | Ty::Vec4).then_some(operand)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scalars_and_vectors() {
        for op in ALL {
            assert_eq!(arithmetic_result(*op, Ty::F32, Ty::F32), Some(Ty::F32));
            assert_eq!(arithmetic_result(*op, Ty::U32, Ty::U32), Some(Ty::U32));
            assert_eq!(arithmetic_result(*op, Ty::Vec3, Ty::Vec3), Some(Ty::Vec3));
            assert_eq!(arithmetic_result(*op, Ty::Vec3, Ty::Vec2), None);
            assert_eq!(arithmetic_result(*op, Ty::F32, Ty::I32), None);
            assert_eq!(arithmetic_result(*op, Ty::Color, Ty::Color), None);
        }
        assert_eq!(
            arithmetic_result(ArithOp::Div, Ty::Vec4, Ty::F32),
            Some(Ty::Vec4)
        );
        assert_eq!(arithmetic_result(ArithOp::Div, Ty::F32, Ty::Vec4), None);
        assert_eq!(
            arithmetic_result(ArithOp::Mul, Ty::F32, Ty::Vec2),
            Some(Ty::Vec2)
        );
        assert_eq!(arithmetic_result(ArithOp::Add, Ty::Vec2, Ty::F32), None);
    }

    #[test]
    fn matrices_and_quaternions_multiply() {
        assert_eq!(
            arithmetic_result(ArithOp::Mul, Ty::Mat4, Ty::Vec4),
            Some(Ty::Vec4)
        );
        assert_eq!(arithmetic_result(ArithOp::Mul, Ty::Vec4, Ty::Mat4), None);
        assert_eq!(
            arithmetic_result(ArithOp::Mul, Ty::Quat, Ty::Quat),
            Some(Ty::Quat)
        );
        assert_eq!(
            arithmetic_result(ArithOp::Mul, Ty::Quat, Ty::Vec3),
            Some(Ty::Vec3)
        );
        assert_eq!(arithmetic_result(ArithOp::Add, Ty::Quat, Ty::Quat), None);
    }

    #[test]
    fn literals_adopt_the_operand_type_the_row_requires() {
        assert_eq!(
            literal_operand_type(ArithOp::Add, Ty::U32, true),
            Some(Ty::U32)
        );
        assert_eq!(
            literal_operand_type(ArithOp::Mul, Ty::Vec3, true),
            Some(Ty::F32)
        );
        assert_eq!(
            literal_operand_type(ArithOp::Mul, Ty::Vec3, false),
            Some(Ty::F32)
        );
        assert_eq!(literal_operand_type(ArithOp::Div, Ty::Vec3, false), None);
        assert_eq!(literal_operand_type(ArithOp::Add, Ty::Vec3, true), None);
        assert_eq!(literal_operand_type(ArithOp::Mul, Ty::Quat, true), None);
    }

    #[test]
    fn negation() {
        assert_eq!(negation_result(Ty::Vec2), Some(Ty::Vec2));
        assert_eq!(negation_result(Ty::I32), Some(Ty::I32));
        assert_eq!(negation_result(Ty::U32), None);
        assert_eq!(negation_result(Ty::Color), None);
        assert_eq!(negation_result(Ty::Quat), None);
    }
}
