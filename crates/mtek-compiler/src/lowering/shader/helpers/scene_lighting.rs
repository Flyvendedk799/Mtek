//! Optional scene lighting ABI 1. These helpers remain structured shader IR, with span maps.
use super::*;
use crate::lowering::shader_ir::{GlobalDecl, GlobalKind, StructDecl, StructMember};

pub(crate) const LIGHTING_STRUCT: &str = "MtekSceneLighting";

pub(crate) fn globals(span: Span) -> Vec<GlobalDecl> {
    let mut globals = vec![GlobalDecl {
        name: Name::generated("scene_lighting"),
        kind: GlobalKind::Uniform {
            group: 3,
            binding: 0,
            ty: ShaderType::named(LIGHTING_STRUCT),
        },
        span,
    }];
    for (name, binding, ty) in [
        ("shadow_map", 1, ShaderType::DepthTexture2d),
        ("shadow_sampler", 2, ShaderType::ComparisonSampler),
        ("environment_map", 3, ShaderType::TextureCube),
        ("environment_sampler", 4, ShaderType::Sampler),
        ("environment_brdf", 5, ShaderType::Texture2d),
    ] {
        globals.push(GlobalDecl {
            name: Name::generated(name),
            kind: GlobalKind::Handle {
                group: 3,
                binding,
                ty,
            },
            span,
        });
    }
    globals
}

pub(crate) fn declaration(span: Span) -> StructDecl {
    StructDecl {
        name: LIGHTING_STRUCT.to_owned(),
        members: [
            ("shadow_matrix", ShaderType::Mat4),
            ("shadow_params", ShaderType::VEC4),
            ("shadow_filter", ShaderType::VEC4),
            ("environment", ShaderType::VEC4),
            (
                "sh",
                ShaderType::Array {
                    element: Box::new(ShaderType::VEC4),
                    length: 9,
                },
            ),
        ]
        .into_iter()
        .map(|(name, ty)| StructMember {
            name: name.to_owned(),
            ty,
            align: None,
            size: None,
            binding: None,
            span,
        })
        .collect(),
        span,
    }
}

impl Builder {
    fn lighting_global(&self, name: &str) -> Expr {
        let global = globals(self.span)
            .into_iter()
            .find(|g| g.name == Name::generated(name));
        // All callers below use names declared immediately above.
        global.map_or_else(|| self.f(0.0), |g| Expr::global(&g, self.span))
    }
    fn lighting_field(&self, name: &str, ty: ShaderType) -> Expr {
        self.lighting_global("scene_lighting")
            .field(name, ty, self.span)
    }
    fn lighting_channel(&self, name: &str, channel: Component) -> Expr {
        self.component(self.lighting_field(name, ShaderType::VEC4), channel)
    }
    fn return_if(&self, condition: Expr, value: Expr) -> Statement {
        Statement::If {
            branches: vec![(condition, vec![self.ret(value)])],
            otherwise: None,
            span: self.span,
        }
    }

    pub(super) fn shadow_visibility(&self) -> Vec<Statement> {
        use Component::{X, Y, Z};
        let local = |name| self.local(name, ShaderType::F32);
        let uv = || self.local("shadow_uv", ShaderType::VEC2);
        let projected = || self.local("shadow_ndc", ShaderType::VEC3);
        let matrix = self.lighting_field("shadow_matrix", ShaderType::Mat4);
        let position = self.add(
            self.local("position", ShaderType::VEC3),
            self.mul(
                self.local("normal", ShaderType::VEC3),
                self.lighting_channel("shadow_params", Z),
            ),
        );
        let mut body = vec![
            self.return_if(
                self.bin(
                    BinaryOp::NotEqual,
                    self.lighting_channel("shadow_params", X),
                    Expr::construct(
                        ShaderType::F32,
                        vec![self.add(
                            self.local("light_index", ShaderType::U32),
                            Expr::literal(Literal::U32(1), self.span),
                        )],
                        self.span,
                    ),
                ),
                self.f(1.0),
            ),
            self.let_(
                "shadow_clip",
                Expr::binary(
                    BinaryOp::Multiply,
                    matrix,
                    self.vec4(vec![position, self.f(1.0)]),
                    ShaderType::VEC4,
                    self.span,
                ),
            ),
            self.let_(
                "shadow_ndc",
                self.div(
                    self.xyz(self.local("shadow_clip", ShaderType::VEC4)),
                    self.component(self.local("shadow_clip", ShaderType::VEC4), Component::W),
                ),
            ),
            self.let_(
                "shadow_uv",
                Expr::construct(
                    ShaderType::VEC2,
                    vec![
                        self.add(
                            self.mul(self.component(projected(), X), self.f(0.5)),
                            self.f(0.5),
                        ),
                        self.add(
                            self.mul(self.component(projected(), Y), self.f(-0.5)),
                            self.f(0.5),
                        ),
                    ],
                    self.span,
                ),
            ),
        ];
        for (value, lower, upper) in [
            (self.component(uv(), X), 0.0, 1.0),
            (self.component(uv(), Y), 0.0, 1.0),
            (self.component(projected(), Z), 0.0, 1.0),
        ] {
            body.push(self.return_if(
                self.bin(
                    BinaryOp::LogicalOr,
                    self.bin(BinaryOp::Less, value.clone(), self.f(lower)),
                    self.bin(BinaryOp::Greater, value, self.f(upper)),
                ),
                self.f(1.0),
            ));
        }
        body.push(Statement::Var {
            name: Name::generated("shadow_sum"),
            value: self.f(0.0),
            span: self.span,
        });
        body.push(Statement::Var {
            name: Name::generated("shadow_count"),
            value: self.f(0.0),
            span: self.span,
        });
        // Explicit comparison level is safe inside the per-light branch. No implicit derivatives.
        let coord = |name| {
            self.sub(
                Expr::construct(
                    ShaderType::F32,
                    vec![self.local(name, ShaderType::U32)],
                    self.span,
                ),
                self.f(2.0),
            )
        };
        let offset = self.mul(
            Expr::construct(
                ShaderType::VEC2,
                vec![coord("shadow_x"), coord("shadow_y")],
                self.span,
            ),
            self.lighting_channel("shadow_filter", X),
        );
        let value = self.call(
            Intrinsic::TextureSampleCompareLevel,
            vec![
                self.lighting_global("shadow_map"),
                self.lighting_global("shadow_sampler"),
                self.add(uv(), offset),
                self.sub(
                    self.component(projected(), Z),
                    self.lighting_channel("shadow_params", Y),
                ),
            ],
            ShaderType::F32,
        );
        let radius = self.call(
            Intrinsic::Max,
            vec![
                self.call(Intrinsic::Abs, vec![coord("shadow_x")], ShaderType::F32),
                self.call(Intrinsic::Abs, vec![coord("shadow_y")], ShaderType::F32),
            ],
            ShaderType::F32,
        );
        let tap = Statement::If {
            branches: vec![(
                self.bin(
                    BinaryOp::GreaterEqual,
                    self.lighting_channel("shadow_filter", Y),
                    radius,
                ),
                vec![
                    Statement::Assign {
                        target: local("shadow_sum"),
                        value: self.add(local("shadow_sum"), value),
                        span: self.span,
                    },
                    Statement::Assign {
                        target: local("shadow_count"),
                        value: self.add(local("shadow_count"), self.f(1.0)),
                        span: self.span,
                    },
                ],
            )],
            otherwise: None,
            span: self.span,
        };
        let loop_ = |name, body| Statement::For {
            name: Name::generated(name),
            start: Expr::literal(Literal::U32(0), self.span),
            end: Expr::literal(Literal::U32(5), self.span),
            body,
            span: self.span,
        };
        body.push(loop_("shadow_y", vec![loop_("shadow_x", vec![tap])]));
        body.push(self.ret(self.div(local("shadow_sum"), local("shadow_count"))));
        body
    }

    fn environment_rotation(&self, direction: Expr) -> Expr {
        use Component::{X, Y, Z};
        let c = || self.lighting_channel("environment", Y);
        let s = || self.lighting_channel("environment", Z);
        let x = || self.component(direction.clone(), X);
        let z = || self.component(direction.clone(), Z);
        self.vec3(vec![
            self.add(self.mul(c(), x()), self.mul(s(), z())),
            self.component(direction.clone(), Y),
            self.sub(self.mul(c(), z()), self.mul(s(), x())),
        ])
    }

    pub(super) fn environment_light(&self) -> Vec<Statement> {
        use Component::{X, Y, Z};
        let v3 = |name| self.local(name, ShaderType::VEC3);
        let s = |name| self.local(name, ShaderType::F32);
        let n = || v3("environment_n");
        let x = || self.component(n(), X);
        let y = || self.component(n(), Y);
        let z = || self.component(n(), Z);
        let mut body = vec![
            self.return_if(
                self.bin(
                    BinaryOp::LessEqual,
                    self.lighting_channel("environment", X),
                    self.f(0.0),
                ),
                self.vec3(vec![self.f(0.0)]),
            ),
            self.let_("environment_n", self.environment_rotation(v3("n"))),
            self.let_(
                "environment_r",
                self.environment_rotation(self.call(
                    Intrinsic::Reflect,
                    vec![v3("v").unary(UnaryOp::Negate, self.span), v3("n")],
                    ShaderType::VEC3,
                )),
            ),
        ];
        let basis = [
            self.f(0.282095),
            self.mul(self.f(0.488603), y()),
            self.mul(self.f(0.488603), z()),
            self.mul(self.f(0.488603), x()),
            self.mul(self.f(1.092548), self.mul(x(), y())),
            self.mul(self.f(1.092548), self.mul(y(), z())),
            self.mul(
                self.f(0.315392),
                self.sub(self.mul(self.f(3.0), self.mul(z(), z())), self.f(1.0)),
            ),
            self.mul(self.f(1.092548), self.mul(x(), z())),
            self.mul(
                self.f(0.546274),
                self.sub(self.mul(x(), x()), self.mul(y(), y())),
            ),
        ];
        let mut irradiance = self.vec3(vec![self.f(0.0)]);
        for (index, term) in basis.into_iter().enumerate() {
            let sh = self
                .lighting_field(
                    "sh",
                    ShaderType::Array {
                        element: Box::new(ShaderType::VEC4),
                        length: 9,
                    },
                )
                .index(
                    Expr::literal(Literal::U32(index as u32), self.span),
                    ShaderType::VEC4,
                    self.span,
                );
            irradiance = self.add(irradiance, self.mul(self.xyz(sh), term));
        }
        body.extend([
            self.let_(
                "irradiance",
                self.call(
                    Intrinsic::Max,
                    vec![irradiance, self.vec3(vec![self.f(0.0)])],
                    ShaderType::VEC3,
                ),
            ),
            self.let_(
                "environment_texel",
                self.xyz(self.call(
                    Intrinsic::TextureSampleLevel,
                    vec![
                        self.lighting_global("environment_map"),
                        self.lighting_global("environment_sampler"),
                        v3("environment_r"),
                        self.mul(s("r"), self.lighting_channel("environment", Component::W)),
                    ],
                    ShaderType::VEC4,
                )),
            ),
            self.let_(
                "brdf",
                self.call(
                    Intrinsic::TextureSampleLevel,
                    vec![
                        self.lighting_global("environment_brdf"),
                        self.lighting_global("environment_sampler"),
                        Expr::construct(ShaderType::VEC2, vec![s("nv"), s("r")], self.span),
                        self.f(0.0),
                    ],
                    ShaderType::VEC4,
                ),
            ),
            self.let_(
                "fresnel_power",
                self.call(
                    Intrinsic::Pow,
                    vec![
                        self.call(
                            Intrinsic::Max,
                            vec![self.sub(self.f(1.0), s("nv")), self.f(0.0)],
                            ShaderType::F32,
                        ),
                        self.f(5.0),
                    ],
                    ShaderType::F32,
                ),
            ),
            self.let_(
                "environment_fresnel",
                self.add(
                    v3("f0"),
                    self.mul(
                        self.sub(
                            self.call(
                                Intrinsic::Max,
                                vec![self.vec3(vec![self.sub(self.f(1.0), s("r"))]), v3("f0")],
                                ShaderType::VEC3,
                            ),
                            v3("f0"),
                        ),
                        s("fresnel_power"),
                    ),
                ),
            ),
            self.let_(
                "environment_diffuse",
                self.mul(
                    self.mul(
                        self.mul(
                            self.sub(self.vec3(vec![self.f(1.0)]), v3("environment_fresnel")),
                            v3("c"),
                        ),
                        self.sub(self.f(1.0), s("m")),
                    ),
                    v3("irradiance"),
                ),
            ),
            self.let_(
                "environment_specular",
                self.mul(
                    v3("environment_texel"),
                    self.add(
                        self.mul(
                            v3("f0"),
                            self.component(self.local("brdf", ShaderType::VEC4), X),
                        ),
                        self.vec3(vec![
                            self.component(self.local("brdf", ShaderType::VEC4), Y),
                        ]),
                    ),
                ),
            ),
            self.ret(self.mul(
                self.add(v3("environment_diffuse"), v3("environment_specular")),
                self.lighting_channel("environment", X),
            )),
        ]);
        body
    }
}
