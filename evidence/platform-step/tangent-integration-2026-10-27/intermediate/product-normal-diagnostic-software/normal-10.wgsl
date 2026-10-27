// Three.js r186 - Node System

// global
diagnostic( off, derivative_uniformity );


// structs

struct OutputStruct {
	@location( 0 ) color: vec4<f32>
};
var<private> output : OutputStruct;

// uniforms
@binding( 1 ) @group( 1 ) var nodeUniform1_sampler : sampler;
@binding( 2 ) @group( 1 ) var nodeUniform1 : texture_2d<f32>;
@binding( 3 ) @group( 1 ) var nodeUniform4_sampler : sampler;
@binding( 4 ) @group( 1 ) var nodeUniform4 : texture_2d<f32>;
@binding( 5 ) @group( 1 ) var nodeUniform15_sampler : sampler;
@binding( 6 ) @group( 1 ) var nodeUniform15 : texture_2d<f32>;
@binding( 7 ) @group( 1 ) var nodeUniform17_sampler : sampler;
@binding( 8 ) @group( 1 ) var nodeUniform17 : texture_2d<f32>;
@binding( 9 ) @group( 1 ) var nodeUniform19_sampler : sampler;
@binding( 10 ) @group( 1 ) var nodeUniform19 : texture_2d<f32>;
@binding( 11 ) @group( 1 ) var nodeUniform29_sampler : sampler_comparison;
@binding( 12 ) @group( 1 ) var nodeUniform29 : texture_depth_2d;
@binding( 13 ) @group( 1 ) var nodeUniform37_sampler : sampler;
@binding( 14 ) @group( 1 ) var nodeUniform37 : texture_2d<f32>;

struct objectStruct {
	nodeUniform0 : vec3<f32>,
	nodeUniform2 : mat3x3<f32>,
	nodeUniform3 : f32,
	nodeUniform5 : mat3x3<f32>,
	nodeUniform6 : f32,
	nodeUniform7 : f32,
	nodeUniform8 : mat3x3<f32>,
	nodeUniform9 : f32,
	nodeUniform10 : mat3x3<f32>,
	nodeUniform12 : mat3x3<f32>,
	nodeUniform13 : vec3<f32>,
	nodeUniform14 : f32,
	nodeUniform16 : mat3x3<f32>,
	nodeUniform18 : mat4x4<f32>,
	nodeUniform20 : mat3x3<f32>,
	nodeUniform21 : vec2<f32>,
	nodeUniform30 : vec2<f32>,
	nodeUniform32 : f32,
	nodeUniform33 : mat4x4<f32>,
	nodeUniform35 : f32,
	nodeUniform36 : f32,
	nodeUniform38 : f32
};
@binding( 0 ) @group( 1 )
var<uniform> object : objectStruct;

struct renderStruct {
	cameraProjectionMatrix : mat4x4<f32>,
	cameraViewMatrix : mat4x4<f32>,
	nodeUniform25 : vec3<f32>,
	nodeUniform23 : vec3<f32>,
	nodeUniform24 : vec3<f32>,
	nodeUniform26 : mat4x4<f32>,
	nodeUniform27 : f32,
	nodeUniform28 : f32,
	nodeUniform31 : f32,
	cameraWorldMatrix : mat4x4<f32>
};
@binding( 0 ) @group( 0 )
var<uniform> render : renderStruct;

// vars
var<private> DiffuseColor : vec4<f32>;
var<private> nodeVar0 : vec4<f32>;
var<private> AmbientOcclusion : f32;
var<private> nodeVar1 : vec4<f32>;
var<private> Metalness : f32;
var<private> nodeVar2 : vec4<f32>;
var<private> Roughness : f32;
var<private> nodeVar3 : vec4<f32>;
var<private> normalViewGeometry : vec3<f32>;
var<private> nodeVar5 : vec3<f32>;
var<private> SpecularColor : vec3<f32>;
var<private> SpecularColorBlended : vec3<f32>;
var<private> SpecularF90 : f32;
var<private> DiffuseContribution : vec3<f32>;
var<private> EmissiveColor : vec3<f32>;
var<private> nodeVar6 : vec4<f32>;
var<private> Output : vec4<f32>;
var<private> NORMAL_tangentView : vec3<f32>;
var<private> NORMAL_bitangentView : vec3<f32>;
var<private> NORMAL_normalView : vec3<f32>;
var<private> NORMAL_TBNViewMatrix : mat3x3<f32>;
var<private> nodeVar7 : vec4<f32>;
var<private> nodeVar8 : vec4<f32>;
var<private> normalView : vec3<f32>;
var<private> positionViewDirection : vec3<f32>;
var<private> nodeVar9 : f32;
var<private> nodeVar10 : vec2<f32>;
var<private> nodeVar11 : f32;
var<private> nodeVar12 : f32;
var<private> nodeVar13 : f32;
var<private> nodeVar14 : f32;
var<private> nodeVar15 : vec3<f32>;
var<private> nodeVar16 : vec3<f32>;
var<private> nodeVar17 : vec3<f32>;
var<private> nodeVar18 : vec4<f32>;
var<private> nodeVar19 : vec4<f32>;
var<private> nodeVar20 : vec3<f32>;
var<private> nodeVar21 : vec3<f32>;
var<private> nodeVar22 : f32;
var<private> shadowPositionWorld : vec3<f32>;
var<private> nodeVar23 : f32;
var<private> normalWorld : vec3<f32>;
var<private> nodeVar24 : vec4<f32>;
var<private> nodeVar25 : vec3<f32>;
var<private> nodeVar26 : vec3<f32>;
var<private> nodeVar27 : vec2<f32>;
var<private> nodeVar28 : vec2<f32>;
var<private> nodeVar29 : f32;
var<private> nodeVar30 : vec2<f32>;
var<private> nodeVar31 : f32;
var<private> nodeVar32 : vec2<f32>;
var<private> nodeVar33 : f32;
var<private> nodeVar34 : vec2<f32>;
var<private> nodeVar35 : f32;
var<private> nodeVar36 : vec2<f32>;
var<private> nodeVar37 : f32;
var<private> nodeVar38 : vec2<f32>;
var<private> nodeVar39 : f32;
var<private> nodeVar40 : vec2<f32>;
var<private> nodeVar41 : f32;
var<private> nodeVar42 : vec2<f32>;
var<private> nodeVar43 : f32;
var<private> nodeVar44 : vec2<f32>;
var<private> nodeVar45 : f32;
var<private> nodeVar46 : f32;
var<private> nodeVar47 : vec3<f32>;
var<private> nodeVar48 : vec3<f32>;
var<private> directDiffuse : vec3<f32>;
var<private> nodeVar49 : vec3<f32>;
var<private> nodeVar50 : vec3<f32>;
var<private> nodeVar51 : vec3<f32>;
var<private> nodeVar52 : vec3<f32>;
var<private> nodeVar53 : f32;
var<private> nodeVar54 : f32;
var<private> nodeVar55 : f32;
var<private> nodeVar56 : vec3<f32>;
var<private> nodeVar57 : vec3<f32>;
var<private> nodeVar58 : vec3<f32>;
var<private> nodeVar59 : vec3<f32>;
var<private> nodeVar60 : vec3<f32>;
var<private> directSpecular : vec3<f32>;
var<private> nodeVar61 : vec3<f32>;
var<private> nodeVar62 : f32;
var<private> nodeVar63 : f32;
var<private> nodeVar64 : f32;
var<private> nodeVar65 : vec3<f32>;
var<private> nodeVar66 : vec3<f32>;
var<private> nodeVar67 : vec3<f32>;
var<private> nodeVar68 : vec3<f32>;
var<private> radiance : vec3<f32>;
var<private> nodeVar69 : f32;
var<private> nodeVar70 : f32;
var<private> nodeVar71 : f32;
var<private> nodeVar72 : vec3<f32>;
var<private> nodeVar73 : f32;
var<private> nodeVar74 : f32;
var<private> nodeVar75 : f32;
var<private> nodeVar76 : vec2<f32>;
var<private> nodeVar77 : vec4<f32>;
var<private> nodeVar78 : vec3<f32>;
var<private> nodeVar79 : f32;
var<private> nodeVar80 : f32;
var<private> nodeVar81 : f32;
var<private> nodeVar82 : f32;
var<private> nodeVar83 : f32;
var<private> nodeVar84 : vec2<f32>;
var<private> nodeVar85 : vec4<f32>;
var<private> nodeVar86 : vec3<f32>;
var<private> nodeVar87 : vec3<f32>;
var<private> iblIrradiance : vec3<f32>;
var<private> nodeVar88 : f32;
var<private> nodeVar89 : f32;
var<private> nodeVar90 : f32;
var<private> nodeVar91 : f32;
var<private> nodeVar92 : f32;
var<private> nodeVar93 : f32;
var<private> nodeVar94 : vec2<f32>;
var<private> nodeVar95 : vec4<f32>;
var<private> nodeVar96 : vec3<f32>;
var<private> nodeVar97 : f32;
var<private> nodeVar98 : f32;
var<private> nodeVar99 : f32;
var<private> nodeVar100 : f32;
var<private> nodeVar101 : f32;
var<private> nodeVar102 : vec2<f32>;
var<private> nodeVar103 : vec4<f32>;
var<private> nodeVar104 : vec3<f32>;
var<private> nodeVar105 : vec3<f32>;
var<private> ambientOcclusion : f32;
var<private> nodeVar106 : f32;
var<private> nodeVar107 : vec3<f32>;
var<private> nodeVar108 : vec3<f32>;
var<private> nodeVar109 : vec3<f32>;
var<private> nodeVar110 : f32;
var<private> nodeVar111 : vec3<f32>;
var<private> nodeVar112 : vec3<f32>;
var<private> nodeVar113 : vec3<f32>;
var<private> nodeVar114 : vec3<f32>;
var<private> nodeVar115 : vec3<f32>;
var<private> nodeVar116 : vec3<f32>;
var<private> nodeVar117 : vec3<f32>;
var<private> nodeVar118 : f32;
var<private> nodeVar119 : f32;
var<private> nodeVar120 : f32;
var<private> nodeVar121 : vec3<f32>;
var<private> nodeVar122 : vec3<f32>;
var<private> nodeVar123 : vec3<f32>;
var<private> nodeVar124 : vec3<f32>;
var<private> nodeVar125 : vec3<f32>;
var<private> nodeVar126 : vec3<f32>;
var<private> irradiance : vec3<f32>;
var<private> nodeVar127 : vec3<f32>;
var<private> nodeVar128 : vec3<f32>;
var<private> nodeVar129 : vec3<f32>;
var<private> nodeVar130 : vec3<f32>;
var<private> nodeVar131 : vec3<f32>;
var<private> nodeVar132 : vec3<f32>;
var<private> nodeVar133 : vec3<f32>;
var<private> indirectDiffuse : vec3<f32>;
var<private> nodeVar134 : vec3<f32>;
var<private> singleScatteringDielectric : vec3<f32>;
var<private> multiScatteringDielectric : vec3<f32>;
var<private> singleScatteringMetallic : vec3<f32>;
var<private> multiScatteringMetallic : vec3<f32>;
var<private> nodeVar135 : vec3<f32>;
var<private> nodeVar136 : f32;
var<private> nodeVar137 : vec3<f32>;
var<private> nodeVar138 : vec3<f32>;
var<private> nodeVar139 : vec3<f32>;
var<private> nodeVar140 : vec3<f32>;
var<private> nodeVar141 : vec3<f32>;
var<private> nodeVar142 : vec3<f32>;
var<private> nodeVar143 : vec3<f32>;
var<private> nodeVar144 : f32;
var<private> nodeVar145 : f32;
var<private> nodeVar146 : f32;
var<private> nodeVar147 : vec3<f32>;
var<private> nodeVar148 : vec3<f32>;
var<private> nodeVar149 : vec3<f32>;
var<private> nodeVar150 : vec3<f32>;
var<private> nodeVar151 : vec3<f32>;
var<private> nodeVar152 : vec3<f32>;
var<private> nodeVar153 : vec3<f32>;
var<private> nodeVar154 : f32;
var<private> nodeVar155 : vec3<f32>;
var<private> nodeVar156 : vec3<f32>;
var<private> nodeVar157 : vec3<f32>;
var<private> nodeVar158 : vec3<f32>;
var<private> nodeVar159 : vec3<f32>;
var<private> nodeVar160 : vec3<f32>;
var<private> nodeVar161 : vec3<f32>;
var<private> nodeVar162 : f32;
var<private> nodeVar163 : f32;
var<private> nodeVar164 : f32;
var<private> nodeVar165 : vec3<f32>;
var<private> nodeVar166 : vec3<f32>;
var<private> nodeVar167 : vec3<f32>;
var<private> nodeVar168 : vec3<f32>;
var<private> nodeVar169 : vec3<f32>;
var<private> nodeVar170 : vec3<f32>;
var<private> nodeVar171 : vec3<f32>;
var<private> nodeVar172 : vec3<f32>;
var<private> nodeVar173 : vec3<f32>;
var<private> nodeVar174 : vec3<f32>;
var<private> nodeVar175 : vec3<f32>;
var<private> nodeVar176 : vec3<f32>;
var<private> nodeVar177 : vec3<f32>;
var<private> nodeVar178 : vec3<f32>;
var<private> nodeVar179 : vec3<f32>;
var<private> nodeVar180 : vec3<f32>;
var<private> nodeVar181 : vec3<f32>;
var<private> nodeVar182 : vec3<f32>;
var<private> nodeVar183 : vec3<f32>;
var<private> indirectSpecular : vec3<f32>;
var<private> nodeVar184 : vec3<f32>;
var<private> nodeVar185 : vec3<f32>;
var<private> nodeVar186 : vec3<f32>;
var<private> nodeVar187 : f32;
var<private> nodeVar188 : f32;
var<private> nodeVar189 : f32;
var<private> nodeVar190 : f32;
var<private> nodeVar191 : f32;
var<private> nodeVar192 : f32;
var<private> nodeVar193 : f32;
var<private> nodeVar194 : f32;
var<private> nodeVar195 : f32;
var<private> nodeVar196 : f32;
var<private> nodeVar197 : f32;
var<private> nodeVar198 : vec3<f32>;
var<private> totalDiffuse : vec3<f32>;
var<private> nodeVar199 : vec3<f32>;
var<private> totalSpecular : vec3<f32>;
var<private> nodeVar200 : vec3<f32>;
var<private> outgoingLight : vec3<f32>;
var<private> nodeVar201 : vec3<f32>;
var<private> nodeVar202 : vec4<f32>;

// codes
fn V_GGX_SmithCorrelated ( alpha : f32, dotNL : f32, dotNV : f32 ) -> f32 {

	var nodeVar0 : f32;

	nodeVar0 = ( alpha * alpha );

	return ( 0.5 / max( ( ( dotNL * sqrt( ( nodeVar0 + ( ( 1.0 - nodeVar0 ) * ( dotNV * dotNV ) ) ) ) ) + ( dotNV * sqrt( ( nodeVar0 + ( ( 1.0 - nodeVar0 ) * ( dotNL * dotNL ) ) ) ) ) ), 0.000001 ) );

}


fn D_GGX ( alpha : f32, dotNH : f32 ) -> f32 {

	var nodeVar0 : f32;
	var nodeVar1 : f32;

	nodeVar0 = ( alpha * alpha );
	nodeVar1 = ( 1.0 - ( ( dotNH * dotNH ) * ( 1.0 - nodeVar0 ) ) );

	return ( ( nodeVar0 / ( nodeVar1 * nodeVar1 ) ) * 0.3183098861837907 );

}


fn roughnessToMip ( roughness : f32 ) -> f32 {

	var nodeVar0 : f32;

	nodeVar0 = 0.0;

	if ( ( roughness >= 0.8 ) ) {

		nodeVar0 = ( ( ( ( 1.0 - roughness ) * ( -1.0 - -2.0 ) ) / ( 1.0 - 0.8 ) ) + -2.0 );
		

	} else {


		if ( ( roughness >= 0.4 ) ) {

			nodeVar0 = ( ( ( ( 0.8 - roughness ) * ( 2.0 - -1.0 ) ) / ( 0.8 - 0.4 ) ) + -1.0 );
			

		} else {


			if ( ( roughness >= 0.305 ) ) {

				nodeVar0 = ( ( ( ( 0.4 - roughness ) * ( 3.0 - 2.0 ) ) / ( 0.4 - 0.305 ) ) + 2.0 );
				

			} else {


				if ( ( roughness >= 0.21 ) ) {

					nodeVar0 = ( ( ( ( 0.305 - roughness ) * ( 4.0 - 3.0 ) ) / ( 0.305 - 0.21 ) ) + 3.0 );
					

				} else {

					nodeVar0 = ( -2.0 * log2( ( 1.16 * roughness ) ) );
					

				}

				

			}

			

		}

		

	}


	return nodeVar0;

}


fn getFace ( direction : vec3<f32> ) -> f32 {

	var nodeVar0 : vec3<f32>;
	var nodeVar1 : f32;
	var nodeVar2 : f32;
	var nodeVar3 : f32;
	var nodeVar4 : f32;
	var nodeVar5 : f32;

	nodeVar0 = abs( direction );
	nodeVar1 = -1.0;

	if ( ( nodeVar0.x > nodeVar0.z ) ) {


		if ( ( nodeVar0.x > nodeVar0.y ) ) {


			if ( ( direction.x > 0.0 ) ) {

				nodeVar2 = 0.0;

			} else {

				nodeVar2 = 3.0;

			}

			nodeVar1 = nodeVar2;
			

		} else {


			if ( ( direction.y > 0.0 ) ) {

				nodeVar3 = 1.0;

			} else {

				nodeVar3 = 4.0;

			}

			nodeVar1 = nodeVar3;
			

		}

		

	} else {


		if ( ( nodeVar0.z > nodeVar0.y ) ) {


			if ( ( direction.z > 0.0 ) ) {

				nodeVar4 = 2.0;

			} else {

				nodeVar4 = 5.0;

			}

			nodeVar1 = nodeVar4;
			

		} else {


			if ( ( direction.y > 0.0 ) ) {

				nodeVar5 = 1.0;

			} else {

				nodeVar5 = 4.0;

			}

			nodeVar1 = nodeVar5;
			

		}

		

	}


	return nodeVar1;

}


fn getUV ( direction : vec3<f32>, face : f32 ) -> vec2<f32> {

	var nodeVar0 : vec2<f32>;

	nodeVar0 = vec2<f32>( 0.0, 0.0 );

	if ( ( face == 0.0 ) ) {

		nodeVar0 = ( vec2<f32>( direction.z, direction.y ) / vec2<f32>( abs( direction.x ) ) );
		

	} else {


		if ( ( face == 1.0 ) ) {

			nodeVar0 = ( vec2<f32>( ( - direction.x ), ( - direction.z ) ) / vec2<f32>( abs( direction.y ) ) );
			

		} else {


			if ( ( face == 2.0 ) ) {

				nodeVar0 = ( vec2<f32>( ( - direction.x ), direction.y ) / vec2<f32>( abs( direction.z ) ) );
				

			} else {


				if ( ( face == 3.0 ) ) {

					nodeVar0 = ( vec2<f32>( ( - direction.z ), direction.y ) / vec2<f32>( abs( direction.x ) ) );
					

				} else {


					if ( ( face == 4.0 ) ) {

						nodeVar0 = ( vec2<f32>( ( - direction.x ), direction.z ) / vec2<f32>( abs( direction.y ) ) );
						

					} else {

						nodeVar0 = ( vec2<f32>( direction.x, direction.y ) / vec2<f32>( abs( direction.z ) ) );
						

					}

					

				}

				

			}

			

		}

		

	}


	return ( vec2<f32>( 0.5 ) * ( nodeVar0 + vec2<f32>( 1.0 ) ) );

}




@fragment
fn main( @location( 0 ) v_normalViewGeometry : vec3<f32>,
	@location( 1 ) v_tangentView : vec3<f32>,
	@location( 2 ) v_bitangentView : vec3<f32>,
	@location( 3 ) v_positionViewDirection : vec3<f32>,
	@location( 4 ) v_positionWorld : vec3<f32>,
	@location( 5 ) NORMAL_v_bitangentView : vec3<f32>,
	@location( 6 ) nodeVarying10 : vec2<f32> ) -> OutputStruct {

	// flow
	// code

	nodeVar0 = textureSample( nodeUniform1, nodeUniform1_sampler, ( object.nodeUniform2 * vec3<f32>( nodeVarying10, 1.0 ) ).xy );
	DiffuseColor = ( vec4<f32>( object.nodeUniform0, 1.0 ) * nodeVar0 );
	DiffuseColor.w = ( DiffuseColor.w * object.nodeUniform3 );
	DiffuseColor.w = 1.0;
	nodeVar1 = textureSample( nodeUniform4, nodeUniform4_sampler, ( object.nodeUniform5 * vec3<f32>( nodeVarying10, 1.0 ) ).xy );
	AmbientOcclusion = ( ( ( nodeVar1.x - 1.0 ) * object.nodeUniform6 ) + 1.0 );
	nodeVar2 = textureSample( nodeUniform4, nodeUniform4_sampler, ( object.nodeUniform8 * vec3<f32>( nodeVarying10, 1.0 ) ).xy );
	Metalness = ( object.nodeUniform7 * nodeVar2.z );
	nodeVar3 = textureSample( nodeUniform4, nodeUniform4_sampler, ( object.nodeUniform10 * vec3<f32>( nodeVarying10, 1.0 ) ).xy );
	normalViewGeometry = normalize( v_normalViewGeometry );
	nodeVar5 = max( abs( dpdx( normalViewGeometry ) ), abs( - dpdy( normalViewGeometry ) ) );
	Roughness = min( ( max( ( object.nodeUniform9 * nodeVar3.y ), 0.0525 ) + max( max( nodeVar5.x, nodeVar5.y ), nodeVar5.z ) ), 1.0 );
	SpecularColor = vec3<f32>( 0.04, 0.04, 0.04 );
	SpecularColorBlended = mix( vec3<f32>( 0.04, 0.04, 0.04 ), DiffuseColor.xyz, Metalness );
	SpecularF90 = 1.0;
	DiffuseContribution = ( DiffuseColor.xyz * vec3<f32>( ( 1.0 - ( object.nodeUniform7 * nodeVar2.z ) ) ) );
	nodeVar6 = textureSample( nodeUniform15, nodeUniform15_sampler, ( object.nodeUniform16 * vec3<f32>( nodeVarying10, 1.0 ) ).xy );
	EmissiveColor = ( vec4<f32>( ( object.nodeUniform13 * vec3<f32>( object.nodeUniform14 ) ), 1.0 ) * nodeVar6 ).xyz;
	NORMAL_tangentView = normalize( v_tangentView );
	NORMAL_bitangentView = normalize( NORMAL_v_bitangentView );
	NORMAL_normalView = normalViewGeometry;
	NORMAL_TBNViewMatrix = mat3x3<f32>( NORMAL_tangentView, NORMAL_bitangentView, NORMAL_normalView );
	nodeVar7 = textureSample( nodeUniform19, nodeUniform19_sampler, ( object.nodeUniform20 * vec3<f32>( nodeVarying10, 1.0 ) ).xy );
	nodeVar8 = ( ( nodeVar7 * vec4<f32>( 2.0 ) ) - vec4<f32>( 1.0 ) );
	normalView = normalize( ( NORMAL_TBNViewMatrix * vec3<f32>( ( nodeVar8.xy * object.nodeUniform21 ), nodeVar8.z ) ) );
	positionViewDirection = normalize( v_positionViewDirection );
	nodeVar9 = dot( normalView, positionViewDirection );
	nodeVar10 = textureSample( nodeUniform17, nodeUniform17_sampler, vec2<f32>( Roughness, clamp( nodeVar9, 0.0, 1.0 ) ) ).xy;
	let dfg = nodeVar10;
	nodeVar11 = ( dfg.x + dfg.y );
	nodeVar12 = ( 1.0 / nodeVar11 );
	nodeVar13 = nodeVar12;
	nodeVar14 = ( nodeVar13 - 1.0 );
	nodeVar15 = ( SpecularColorBlended * vec3<f32>( nodeVar14 ) );
	nodeVar16 = ( nodeVar15 + vec3<f32>( 1.0 ) );
	let multiScatteringCompensation = nodeVar16;
	nodeVar17 = ( render.nodeUniform23 - render.nodeUniform24 );
	nodeVar18 = vec4<f32>( nodeVar17, 0.0 );
	nodeVar19 = ( render.cameraViewMatrix * nodeVar18 );
	nodeVar20 = normalize( nodeVar19.xyz );
	nodeVar21 = nodeVar20;
	nodeVar22 = dot( normalView, nodeVar21 );
	shadowPositionWorld = v_positionWorld;
	normalWorld = normalize( ( vec4<f32>( normalView, 0.0 ) * render.cameraViewMatrix ).xyz );
	nodeVar24 = ( render.nodeUniform26 * vec4<f32>( ( shadowPositionWorld + ( normalWorld * vec3<f32>( render.nodeUniform27 ) ) ), 1.0 ) );
	nodeVar25 = ( nodeVar24.xyz / vec3<f32>( nodeVar24.w ) );
	nodeVar26 = vec3<f32>( nodeVar25.x, ( 1.0 - nodeVar25.y ), ( nodeVar25.z + render.nodeUniform28 ) );

	if ( ( ( ( ( ( nodeVar26.x >= 0.0 ) && ( nodeVar26.x <= 1.0 ) ) && ( nodeVar26.y >= 0.0 ) ) && ( nodeVar26.y <= 1.0 ) ) && ( nodeVar26.z <= 1.0 ) ) ) {

		nodeVar27 = ( vec2<f32>( 1.0, 1.0 ) / object.nodeUniform30 );
		nodeVar28 = ( nodeVar26.xy + ( nodeVar27 * vec2<f32>( -1.0, -1.0 ) ) );
		nodeVar29 = textureSampleCompare( nodeUniform29, nodeUniform29_sampler, nodeVar28, nodeVar26.z );
		nodeVar30 = ( nodeVar26.xy + ( nodeVar27 * vec2<f32>( 0.0, -1.0 ) ) );
		nodeVar31 = textureSampleCompare( nodeUniform29, nodeUniform29_sampler, nodeVar30, nodeVar26.z );
		nodeVar32 = ( nodeVar26.xy + ( nodeVar27 * vec2<f32>( 1.0, -1.0 ) ) );
		nodeVar33 = textureSampleCompare( nodeUniform29, nodeUniform29_sampler, nodeVar32, nodeVar26.z );
		nodeVar34 = ( nodeVar26.xy + ( nodeVar27 * vec2<f32>( -1.0, 0.0 ) ) );
		nodeVar35 = textureSampleCompare( nodeUniform29, nodeUniform29_sampler, nodeVar34, nodeVar26.z );
		nodeVar36 = ( nodeVar26.xy + ( nodeVar27 * vec2<f32>( 0.0, 0.0 ) ) );
		nodeVar37 = textureSampleCompare( nodeUniform29, nodeUniform29_sampler, nodeVar36, nodeVar26.z );
		nodeVar38 = ( nodeVar26.xy + ( nodeVar27 * vec2<f32>( 1.0, 0.0 ) ) );
		nodeVar39 = textureSampleCompare( nodeUniform29, nodeUniform29_sampler, nodeVar38, nodeVar26.z );
		nodeVar40 = ( nodeVar26.xy + ( nodeVar27 * vec2<f32>( -1.0, 1.0 ) ) );
		nodeVar41 = textureSampleCompare( nodeUniform29, nodeUniform29_sampler, nodeVar40, nodeVar26.z );
		nodeVar42 = ( nodeVar26.xy + ( nodeVar27 * vec2<f32>( 0.0, 1.0 ) ) );
		nodeVar43 = textureSampleCompare( nodeUniform29, nodeUniform29_sampler, nodeVar42, nodeVar26.z );
		nodeVar44 = ( nodeVar26.xy + ( nodeVar27 * vec2<f32>( 1.0, 1.0 ) ) );
		nodeVar45 = textureSampleCompare( nodeUniform29, nodeUniform29_sampler, nodeVar44, nodeVar26.z );
		nodeVar23 = ( ( ( ( ( ( ( ( ( ( 0.0 + nodeVar29 ) + nodeVar31 ) + nodeVar33 ) + nodeVar35 ) + nodeVar37 ) + nodeVar39 ) + nodeVar41 ) + nodeVar43 ) + nodeVar45 ) / 9.0 );

	} else {

		nodeVar23 = 1.0;

	}

	nodeVar46 = mix( 1.0, nodeVar23, render.nodeUniform31 );
	nodeVar47 = ( vec3<f32>( clamp( nodeVar22, 0.0, 1.0 ) ) * ( render.nodeUniform25 * vec3<f32>( nodeVar46 ) ) );
	nodeVar48 = nodeVar47;
	directDiffuse = vec3<f32>( 0.0, 0.0, 0.0 );
	nodeVar49 = ( DiffuseContribution * vec3<f32>( 0.3183098861837907 ) );
	nodeVar50 = ( nodeVar48 * nodeVar49 );
	nodeVar51 = ( nodeVar21 + positionViewDirection );
	nodeVar52 = normalize( nodeVar51 );
	nodeVar53 = dot( positionViewDirection, nodeVar52 );
	nodeVar54 = clamp( nodeVar53, 0.0, 1.0 );
	nodeVar55 = exp2( ( ( ( nodeVar54 * -5.55473 ) - 6.98316 ) * nodeVar54 ) );
	nodeVar56 = ( ( SpecularColor * vec3<f32>( ( 1.0 - nodeVar55 ) ) ) + vec3<f32>( ( SpecularF90 * nodeVar55 ) ) );
	nodeVar57 = ( vec3<f32>( 1.0 ) - nodeVar56 );
	nodeVar58 = nodeVar57;
	nodeVar59 = ( nodeVar50 * nodeVar58 );
	nodeVar60 = ( directDiffuse + nodeVar59 );
	directDiffuse = nodeVar60;
	directSpecular = vec3<f32>( 0.0, 0.0, 0.0 );
	nodeVar61 = normalize( ( nodeVar21 + positionViewDirection ) );
	nodeVar62 = clamp( dot( positionViewDirection, nodeVar61 ), 0.0, 1.0 );
	nodeVar63 = exp2( ( ( ( nodeVar62 * -5.55473 ) - 6.98316 ) * nodeVar62 ) );
	nodeVar64 = ( Roughness * Roughness );
	nodeVar65 = ( ( ( ( SpecularColorBlended * vec3<f32>( ( 1.0 - nodeVar63 ) ) ) + vec3<f32>( ( 1.0 * nodeVar63 ) ) ) * vec3<f32>( V_GGX_SmithCorrelated( nodeVar64, clamp( dot( normalView, nodeVar21 ), 0.0, 1.0 ), clamp( dot( normalView, positionViewDirection ), 0.0, 1.0 ) ) ) ) * vec3<f32>( D_GGX( nodeVar64, clamp( dot( normalView, nodeVar61 ), 0.0, 1.0 ) ) ) );
	nodeVar66 = ( nodeVar48 * nodeVar65 );
	nodeVar67 = ( nodeVar66 * multiScatteringCompensation );
	nodeVar68 = ( directSpecular + nodeVar67 );
	directSpecular = nodeVar68;
	radiance = vec3<f32>( 0.0, 0.0, 0.0 );
	nodeVar69 = clamp( roughnessToMip( Roughness ), -2.0, object.nodeUniform32 );
	nodeVar70 = floor( nodeVar69 );
	nodeVar71 = nodeVar70;
	nodeVar72 = normalize( ( render.cameraWorldMatrix * vec4<f32>( normalize( mix( reflect( ( - positionViewDirection ), normalView ), normalView, ( ( ( Roughness * Roughness ) * Roughness ) * Roughness ) ) ), 0.0 ) ).xyz );
	nodeVar73 = getFace( ( object.nodeUniform33 * vec4<f32>( vec3<f32>( nodeVar72.x, ( - nodeVar72.y ), nodeVar72.z ), 1.0 ) ).xyz );
	nodeVar74 = max( ( 4.0 - nodeVar71 ), 0.0 );
	nodeVar71 = max( nodeVar71, 4.0 );
	nodeVar75 = exp2( nodeVar71 );
	nodeVar76 = ( ( getUV( ( object.nodeUniform33 * vec4<f32>( vec3<f32>( nodeVar72.x, ( - nodeVar72.y ), nodeVar72.z ), 1.0 ) ).xyz, nodeVar73 ) * vec2<f32>( ( nodeVar75 - 2.0 ) ) ) + vec2<f32>( 1.0 ) );

	if ( ( nodeVar73 > 2.0 ) ) {

		nodeVar76.y = ( nodeVar76.y + nodeVar75 );
		nodeVar73 = ( nodeVar73 - 3.0 );
		

	}

	nodeVar76.x = ( nodeVar76.x + ( nodeVar73 * nodeVar75 ) );
	nodeVar76.x = ( nodeVar76.x + ( nodeVar74 * ( 3.0 * 16.0 ) ) );
	nodeVar76.y = ( nodeVar76.y + ( 4.0 * ( exp2( object.nodeUniform32 ) - nodeVar75 ) ) );
	nodeVar76.x = ( nodeVar76.x * object.nodeUniform35 );
	nodeVar76.y = ( nodeVar76.y * object.nodeUniform36 );
	nodeVar77 = textureSampleGrad( nodeUniform37, nodeUniform37_sampler, nodeVar76, vec2<f32>( 0.0, 0.0 ), vec2<f32>( 0.0, 0.0 ) );
	nodeVar78 = nodeVar77.xyz;
	nodeVar79 = fract( nodeVar69 );

	if ( ( nodeVar79 != 0.0 ) ) {

		nodeVar80 = ( nodeVar70 + 1.0 );
		nodeVar81 = getFace( ( object.nodeUniform33 * vec4<f32>( vec3<f32>( nodeVar72.x, ( - nodeVar72.y ), nodeVar72.z ), 1.0 ) ).xyz );
		nodeVar82 = max( ( 4.0 - nodeVar80 ), 0.0 );
		nodeVar80 = max( nodeVar80, 4.0 );
		nodeVar83 = exp2( nodeVar80 );
		nodeVar84 = ( ( getUV( ( object.nodeUniform33 * vec4<f32>( vec3<f32>( nodeVar72.x, ( - nodeVar72.y ), nodeVar72.z ), 1.0 ) ).xyz, nodeVar81 ) * vec2<f32>( ( nodeVar83 - 2.0 ) ) ) + vec2<f32>( 1.0 ) );

		if ( ( nodeVar81 > 2.0 ) ) {

			nodeVar84.y = ( nodeVar84.y + nodeVar83 );
			nodeVar81 = ( nodeVar81 - 3.0 );
			

		}

		nodeVar84.x = ( nodeVar84.x + ( nodeVar81 * nodeVar83 ) );
		nodeVar84.x = ( nodeVar84.x + ( nodeVar82 * ( 3.0 * 16.0 ) ) );
		nodeVar84.y = ( nodeVar84.y + ( 4.0 * ( exp2( object.nodeUniform32 ) - nodeVar83 ) ) );
		nodeVar84.x = ( nodeVar84.x * object.nodeUniform35 );
		nodeVar84.y = ( nodeVar84.y * object.nodeUniform36 );
		nodeVar85 = textureSampleGrad( nodeUniform37, nodeUniform37_sampler, nodeVar84, vec2<f32>( 0.0, 0.0 ), vec2<f32>( 0.0, 0.0 ) );
		nodeVar86 = nodeVar85.xyz;
		nodeVar78 = mix( nodeVar78, nodeVar86, nodeVar79 );
		

	}

	nodeVar87 = ( radiance + ( nodeVar78 * vec3<f32>( object.nodeUniform38 ) ) );
	radiance = nodeVar87;
	iblIrradiance = vec3<f32>( 0.0, 0.0, 0.0 );
	nodeVar88 = clamp( roughnessToMip( 1.0 ), -2.0, object.nodeUniform32 );
	nodeVar89 = floor( nodeVar88 );
	nodeVar90 = nodeVar89;
	nodeVar91 = getFace( ( object.nodeUniform33 * vec4<f32>( vec3<f32>( normalWorld.x, ( - normalWorld.y ), normalWorld.z ), 1.0 ) ).xyz );
	nodeVar92 = max( ( 4.0 - nodeVar90 ), 0.0 );
	nodeVar90 = max( nodeVar90, 4.0 );
	nodeVar93 = exp2( nodeVar90 );
	nodeVar94 = ( ( getUV( ( object.nodeUniform33 * vec4<f32>( vec3<f32>( normalWorld.x, ( - normalWorld.y ), normalWorld.z ), 1.0 ) ).xyz, nodeVar91 ) * vec2<f32>( ( nodeVar93 - 2.0 ) ) ) + vec2<f32>( 1.0 ) );

	if ( ( nodeVar91 > 2.0 ) ) {

		nodeVar94.y = ( nodeVar94.y + nodeVar93 );
		nodeVar91 = ( nodeVar91 - 3.0 );
		

	}

	nodeVar94.x = ( nodeVar94.x + ( nodeVar91 * nodeVar93 ) );
	nodeVar94.x = ( nodeVar94.x + ( nodeVar92 * ( 3.0 * 16.0 ) ) );
	nodeVar94.y = ( nodeVar94.y + ( 4.0 * ( exp2( object.nodeUniform32 ) - nodeVar93 ) ) );
	nodeVar94.x = ( nodeVar94.x * object.nodeUniform35 );
	nodeVar94.y = ( nodeVar94.y * object.nodeUniform36 );
	nodeVar95 = textureSampleGrad( nodeUniform37, nodeUniform37_sampler, nodeVar94, vec2<f32>( 0.0, 0.0 ), vec2<f32>( 0.0, 0.0 ) );
	nodeVar96 = nodeVar95.xyz;
	nodeVar97 = fract( nodeVar88 );

	if ( ( nodeVar97 != 0.0 ) ) {

		nodeVar98 = ( nodeVar89 + 1.0 );
		nodeVar99 = getFace( ( object.nodeUniform33 * vec4<f32>( vec3<f32>( normalWorld.x, ( - normalWorld.y ), normalWorld.z ), 1.0 ) ).xyz );
		nodeVar100 = max( ( 4.0 - nodeVar98 ), 0.0 );
		nodeVar98 = max( nodeVar98, 4.0 );
		nodeVar101 = exp2( nodeVar98 );
		nodeVar102 = ( ( getUV( ( object.nodeUniform33 * vec4<f32>( vec3<f32>( normalWorld.x, ( - normalWorld.y ), normalWorld.z ), 1.0 ) ).xyz, nodeVar99 ) * vec2<f32>( ( nodeVar101 - 2.0 ) ) ) + vec2<f32>( 1.0 ) );

		if ( ( nodeVar99 > 2.0 ) ) {

			nodeVar102.y = ( nodeVar102.y + nodeVar101 );
			nodeVar99 = ( nodeVar99 - 3.0 );
			

		}

		nodeVar102.x = ( nodeVar102.x + ( nodeVar99 * nodeVar101 ) );
		nodeVar102.x = ( nodeVar102.x + ( nodeVar100 * ( 3.0 * 16.0 ) ) );
		nodeVar102.y = ( nodeVar102.y + ( 4.0 * ( exp2( object.nodeUniform32 ) - nodeVar101 ) ) );
		nodeVar102.x = ( nodeVar102.x * object.nodeUniform35 );
		nodeVar102.y = ( nodeVar102.y * object.nodeUniform36 );
		nodeVar103 = textureSampleGrad( nodeUniform37, nodeUniform37_sampler, nodeVar102, vec2<f32>( 0.0, 0.0 ), vec2<f32>( 0.0, 0.0 ) );
		nodeVar104 = nodeVar103.xyz;
		nodeVar96 = mix( nodeVar96, nodeVar104, nodeVar97 );
		

	}

	nodeVar105 = ( iblIrradiance + ( ( nodeVar96 * vec3<f32>( 3.141592653589793 ) ) * vec3<f32>( object.nodeUniform38 ) ) );
	iblIrradiance = nodeVar105;
	ambientOcclusion = 1.0;
	nodeVar106 = ( ambientOcclusion * AmbientOcclusion );
	ambientOcclusion = nodeVar106;
	nodeVar107 = vec3<f32>( 0.0, 0.0, 0.0 );
	nodeVar108 = vec3<f32>( 0.0, 0.0, 0.0 );
	nodeVar109 = ( SpecularColor * vec3<f32>( dfg.x ) );
	nodeVar110 = ( SpecularF90 * dfg.y );
	nodeVar111 = ( nodeVar109 + vec3<f32>( nodeVar110 ) );
	nodeVar112 = ( nodeVar107 + nodeVar111 );
	nodeVar107 = nodeVar112;
	nodeVar113 = ( vec3<f32>( 1.0 ) - SpecularColor );
	nodeVar114 = nodeVar113;
	nodeVar115 = ( nodeVar114 * vec3<f32>( 0.047619 ) );
	nodeVar116 = ( SpecularColor + nodeVar115 );
	nodeVar117 = ( nodeVar111 * nodeVar116 );
	nodeVar118 = ( dfg.x + dfg.y );
	nodeVar119 = ( 1.0 - nodeVar118 );
	nodeVar120 = nodeVar119;
	nodeVar121 = ( vec3<f32>( nodeVar120 ) * nodeVar116 );
	nodeVar122 = ( vec3<f32>( 1.0 ) - nodeVar121 );
	nodeVar123 = nodeVar122;
	nodeVar124 = ( nodeVar117 / nodeVar123 );
	nodeVar125 = ( nodeVar124 * vec3<f32>( nodeVar120 ) );
	nodeVar126 = ( nodeVar108 + nodeVar125 );
	nodeVar108 = nodeVar126;
	irradiance = vec3<f32>( 0.0, 0.0, 0.0 );
	nodeVar127 = ( DiffuseContribution * vec3<f32>( 0.3183098861837907 ) );
	nodeVar128 = ( irradiance * nodeVar127 );
	nodeVar129 = ( nodeVar107 + nodeVar108 );
	nodeVar130 = ( vec3<f32>( 1.0 ) - nodeVar129 );
	nodeVar131 = nodeVar130;
	nodeVar132 = ( nodeVar128 * nodeVar131 );
	nodeVar133 = nodeVar132;
	indirectDiffuse = vec3<f32>( 0.0, 0.0, 0.0 );
	nodeVar134 = ( indirectDiffuse + nodeVar133 );
	indirectDiffuse = nodeVar134;
	singleScatteringDielectric = vec3<f32>( 0.0, 0.0, 0.0 );
	multiScatteringDielectric = vec3<f32>( 0.0, 0.0, 0.0 );
	singleScatteringMetallic = vec3<f32>( 0.0, 0.0, 0.0 );
	multiScatteringMetallic = vec3<f32>( 0.0, 0.0, 0.0 );
	nodeVar135 = ( SpecularColor * vec3<f32>( dfg.x ) );
	nodeVar136 = ( SpecularF90 * dfg.y );
	nodeVar137 = ( nodeVar135 + vec3<f32>( nodeVar136 ) );
	nodeVar138 = ( singleScatteringDielectric + nodeVar137 );
	singleScatteringDielectric = nodeVar138;
	nodeVar139 = ( vec3<f32>( 1.0 ) - SpecularColor );
	nodeVar140 = nodeVar139;
	nodeVar141 = ( nodeVar140 * vec3<f32>( 0.047619 ) );
	nodeVar142 = ( SpecularColor + nodeVar141 );
	nodeVar143 = ( nodeVar137 * nodeVar142 );
	nodeVar144 = ( dfg.x + dfg.y );
	nodeVar145 = ( 1.0 - nodeVar144 );
	nodeVar146 = nodeVar145;
	nodeVar147 = ( vec3<f32>( nodeVar146 ) * nodeVar142 );
	nodeVar148 = ( vec3<f32>( 1.0 ) - nodeVar147 );
	nodeVar149 = nodeVar148;
	nodeVar150 = ( nodeVar143 / nodeVar149 );
	nodeVar151 = ( nodeVar150 * vec3<f32>( nodeVar146 ) );
	nodeVar152 = ( multiScatteringDielectric + nodeVar151 );
	multiScatteringDielectric = nodeVar152;
	nodeVar153 = ( DiffuseColor.xyz * vec3<f32>( dfg.x ) );
	nodeVar154 = ( SpecularF90 * dfg.y );
	nodeVar155 = ( nodeVar153 + vec3<f32>( nodeVar154 ) );
	nodeVar156 = ( singleScatteringMetallic + nodeVar155 );
	singleScatteringMetallic = nodeVar156;
	nodeVar157 = ( vec3<f32>( 1.0 ) - DiffuseColor.xyz );
	nodeVar158 = nodeVar157;
	nodeVar159 = ( nodeVar158 * vec3<f32>( 0.047619 ) );
	nodeVar160 = ( DiffuseColor.xyz + nodeVar159 );
	nodeVar161 = ( nodeVar155 * nodeVar160 );
	nodeVar162 = ( dfg.x + dfg.y );
	nodeVar163 = ( 1.0 - nodeVar162 );
	nodeVar164 = nodeVar163;
	nodeVar165 = ( vec3<f32>( nodeVar164 ) * nodeVar160 );
	nodeVar166 = ( vec3<f32>( 1.0 ) - nodeVar165 );
	nodeVar167 = nodeVar166;
	nodeVar168 = ( nodeVar161 / nodeVar167 );
	nodeVar169 = ( nodeVar168 * vec3<f32>( nodeVar164 ) );
	nodeVar170 = ( multiScatteringMetallic + nodeVar169 );
	multiScatteringMetallic = nodeVar170;
	nodeVar171 = mix( singleScatteringDielectric, singleScatteringMetallic, Metalness );
	nodeVar172 = ( radiance * nodeVar171 );
	nodeVar173 = mix( multiScatteringDielectric, multiScatteringMetallic, Metalness );
	nodeVar174 = ( iblIrradiance * vec3<f32>( 0.3183098861837907 ) );
	nodeVar175 = ( nodeVar173 * nodeVar174 );
	nodeVar176 = ( nodeVar172 + nodeVar175 );
	nodeVar177 = nodeVar176;
	nodeVar178 = ( singleScatteringDielectric + multiScatteringDielectric );
	nodeVar179 = ( vec3<f32>( 1.0 ) - nodeVar178 );
	nodeVar180 = nodeVar179;
	nodeVar181 = ( DiffuseContribution * nodeVar180 );
	nodeVar182 = ( nodeVar181 * nodeVar174 );
	nodeVar183 = nodeVar182;
	indirectSpecular = vec3<f32>( 0.0, 0.0, 0.0 );
	nodeVar184 = ( indirectSpecular + nodeVar177 );
	indirectSpecular = nodeVar184;
	nodeVar185 = ( indirectDiffuse + nodeVar183 );
	indirectDiffuse = nodeVar185;
	nodeVar186 = ( indirectDiffuse * vec3<f32>( ambientOcclusion ) );
	indirectDiffuse = nodeVar186;
	nodeVar187 = dot( normalView, positionViewDirection );
	nodeVar188 = ( clamp( nodeVar187, 0.0, 1.0 ) + ambientOcclusion );
	nodeVar189 = ( Roughness * -16.0 );
	nodeVar190 = ( 1.0 - nodeVar189 );
	nodeVar191 = nodeVar190;
	nodeVar192 = ( - nodeVar191 );
	nodeVar193 = exp2( nodeVar192 );
	nodeVar194 = pow( nodeVar188, nodeVar193 );
	nodeVar195 = ( 1.0 - nodeVar194 );
	nodeVar196 = nodeVar195;
	nodeVar197 = ( ambientOcclusion - nodeVar196 );
	nodeVar198 = ( indirectSpecular * vec3<f32>( clamp( nodeVar197, 0.0, 1.0 ) ) );
	indirectSpecular = nodeVar198;
	nodeVar199 = ( directDiffuse + indirectDiffuse );
	totalDiffuse = nodeVar199;
	nodeVar200 = ( directSpecular + indirectSpecular );
	totalSpecular = nodeVar200;
	nodeVar201 = ( totalDiffuse + totalSpecular );
	outgoingLight = nodeVar201;
	nodeVar202 = max( vec4<f32>( ( outgoingLight + EmissiveColor ), DiffuseColor.w ), vec4<f32>( 0.0 ) );
	Output = nodeVar202;

	// result

	output.color = nodeVar202;

	return output;

}
