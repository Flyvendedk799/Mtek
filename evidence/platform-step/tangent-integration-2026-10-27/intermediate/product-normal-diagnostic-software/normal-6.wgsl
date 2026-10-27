// Three.js r186 - Node System

// global
diagnostic( off, derivative_uniformity );


// structs

struct OutputStruct {
	@location( 0 ) color: vec4<f32>
};
var<private> output : OutputStruct;

// uniforms
@binding( 1 ) @group( 1 ) var nodeUniform8_sampler : sampler;
@binding( 2 ) @group( 1 ) var nodeUniform8 : texture_2d<f32>;
@binding( 3 ) @group( 1 ) var nodeUniform17_sampler : sampler_comparison;
@binding( 4 ) @group( 1 ) var nodeUniform17 : texture_depth_2d;
@binding( 5 ) @group( 1 ) var nodeUniform25_sampler : sampler;
@binding( 6 ) @group( 1 ) var nodeUniform25 : texture_2d<f32>;

struct objectStruct {
	nodeUniform0 : vec3<f32>,
	nodeUniform1 : f32,
	nodeUniform2 : f32,
	nodeUniform3 : f32,
	nodeUniform5 : mat3x3<f32>,
	nodeUniform6 : vec3<f32>,
	nodeUniform7 : f32,
	nodeUniform9 : mat4x4<f32>,
	nodeUniform18 : vec2<f32>,
	nodeUniform20 : f32,
	nodeUniform21 : mat4x4<f32>,
	nodeUniform23 : f32,
	nodeUniform24 : f32,
	nodeUniform26 : f32
};
@binding( 0 ) @group( 1 )
var<uniform> object : objectStruct;

struct renderStruct {
	cameraProjectionMatrix : mat4x4<f32>,
	cameraViewMatrix : mat4x4<f32>,
	nodeUniform13 : vec3<f32>,
	nodeUniform11 : vec3<f32>,
	nodeUniform12 : vec3<f32>,
	nodeUniform14 : mat4x4<f32>,
	nodeUniform15 : f32,
	nodeUniform16 : f32,
	nodeUniform19 : f32,
	cameraWorldMatrix : mat4x4<f32>
};
@binding( 0 ) @group( 0 )
var<uniform> render : renderStruct;

// vars
var<private> DiffuseColor : vec4<f32>;
var<private> Metalness : f32;
var<private> Roughness : f32;
var<private> normalViewGeometry : vec3<f32>;
var<private> nodeVar0 : vec3<f32>;
var<private> SpecularColor : vec3<f32>;
var<private> SpecularColorBlended : vec3<f32>;
var<private> SpecularF90 : f32;
var<private> DiffuseContribution : vec3<f32>;
var<private> EmissiveColor : vec3<f32>;
var<private> Output : vec4<f32>;
var<private> NORMAL_normalView : vec3<f32>;
var<private> normalView : vec3<f32>;
var<private> positionViewDirection : vec3<f32>;
var<private> nodeVar1 : f32;
var<private> nodeVar2 : vec2<f32>;
var<private> nodeVar3 : f32;
var<private> nodeVar4 : f32;
var<private> nodeVar5 : f32;
var<private> nodeVar6 : f32;
var<private> nodeVar7 : vec3<f32>;
var<private> nodeVar8 : vec3<f32>;
var<private> nodeVar9 : vec3<f32>;
var<private> nodeVar10 : vec4<f32>;
var<private> nodeVar11 : vec4<f32>;
var<private> nodeVar12 : vec3<f32>;
var<private> nodeVar13 : vec3<f32>;
var<private> nodeVar14 : f32;
var<private> shadowPositionWorld : vec3<f32>;
var<private> nodeVar15 : f32;
var<private> normalWorld : vec3<f32>;
var<private> nodeVar16 : vec4<f32>;
var<private> nodeVar17 : vec3<f32>;
var<private> nodeVar18 : vec3<f32>;
var<private> nodeVar19 : vec2<f32>;
var<private> nodeVar20 : vec2<f32>;
var<private> nodeVar21 : f32;
var<private> nodeVar22 : vec2<f32>;
var<private> nodeVar23 : f32;
var<private> nodeVar24 : vec2<f32>;
var<private> nodeVar25 : f32;
var<private> nodeVar26 : vec2<f32>;
var<private> nodeVar27 : f32;
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
var<private> nodeVar38 : f32;
var<private> nodeVar39 : vec3<f32>;
var<private> nodeVar40 : vec3<f32>;
var<private> nodeVar41 : vec3<f32>;
var<private> directDiffuse : vec3<f32>;
var<private> nodeVar42 : vec3<f32>;
var<private> nodeVar43 : vec3<f32>;
var<private> nodeVar44 : vec3<f32>;
var<private> nodeVar45 : vec3<f32>;
var<private> nodeVar46 : f32;
var<private> nodeVar47 : f32;
var<private> nodeVar48 : f32;
var<private> nodeVar49 : vec3<f32>;
var<private> nodeVar50 : vec3<f32>;
var<private> nodeVar51 : vec3<f32>;
var<private> nodeVar52 : vec3<f32>;
var<private> nodeVar53 : vec3<f32>;
var<private> directSpecular : vec3<f32>;
var<private> nodeVar54 : vec3<f32>;
var<private> nodeVar55 : f32;
var<private> nodeVar56 : f32;
var<private> nodeVar57 : f32;
var<private> nodeVar58 : vec3<f32>;
var<private> nodeVar59 : vec3<f32>;
var<private> nodeVar60 : vec3<f32>;
var<private> nodeVar61 : vec3<f32>;
var<private> radiance : vec3<f32>;
var<private> nodeVar62 : f32;
var<private> nodeVar63 : f32;
var<private> nodeVar64 : f32;
var<private> nodeVar65 : vec3<f32>;
var<private> nodeVar66 : f32;
var<private> nodeVar67 : f32;
var<private> nodeVar68 : f32;
var<private> nodeVar69 : vec2<f32>;
var<private> nodeVar70 : vec4<f32>;
var<private> nodeVar71 : vec3<f32>;
var<private> nodeVar72 : f32;
var<private> nodeVar73 : f32;
var<private> nodeVar74 : f32;
var<private> nodeVar75 : f32;
var<private> nodeVar76 : f32;
var<private> nodeVar77 : vec2<f32>;
var<private> nodeVar78 : vec4<f32>;
var<private> nodeVar79 : vec3<f32>;
var<private> nodeVar80 : vec3<f32>;
var<private> iblIrradiance : vec3<f32>;
var<private> nodeVar81 : f32;
var<private> nodeVar82 : f32;
var<private> nodeVar83 : f32;
var<private> nodeVar84 : f32;
var<private> nodeVar85 : f32;
var<private> nodeVar86 : f32;
var<private> nodeVar87 : vec2<f32>;
var<private> nodeVar88 : vec4<f32>;
var<private> nodeVar89 : vec3<f32>;
var<private> nodeVar90 : f32;
var<private> nodeVar91 : f32;
var<private> nodeVar92 : f32;
var<private> nodeVar93 : f32;
var<private> nodeVar94 : f32;
var<private> nodeVar95 : vec2<f32>;
var<private> nodeVar96 : vec4<f32>;
var<private> nodeVar97 : vec3<f32>;
var<private> nodeVar98 : vec3<f32>;
var<private> nodeVar99 : vec3<f32>;
var<private> nodeVar100 : vec3<f32>;
var<private> nodeVar101 : vec3<f32>;
var<private> nodeVar102 : f32;
var<private> nodeVar103 : vec3<f32>;
var<private> nodeVar104 : vec3<f32>;
var<private> nodeVar105 : vec3<f32>;
var<private> nodeVar106 : vec3<f32>;
var<private> nodeVar107 : vec3<f32>;
var<private> nodeVar108 : vec3<f32>;
var<private> nodeVar109 : vec3<f32>;
var<private> nodeVar110 : f32;
var<private> nodeVar111 : f32;
var<private> nodeVar112 : f32;
var<private> nodeVar113 : vec3<f32>;
var<private> nodeVar114 : vec3<f32>;
var<private> nodeVar115 : vec3<f32>;
var<private> nodeVar116 : vec3<f32>;
var<private> nodeVar117 : vec3<f32>;
var<private> nodeVar118 : vec3<f32>;
var<private> irradiance : vec3<f32>;
var<private> nodeVar119 : vec3<f32>;
var<private> nodeVar120 : vec3<f32>;
var<private> nodeVar121 : vec3<f32>;
var<private> nodeVar122 : vec3<f32>;
var<private> nodeVar123 : vec3<f32>;
var<private> nodeVar124 : vec3<f32>;
var<private> nodeVar125 : vec3<f32>;
var<private> indirectDiffuse : vec3<f32>;
var<private> nodeVar126 : vec3<f32>;
var<private> singleScatteringDielectric : vec3<f32>;
var<private> multiScatteringDielectric : vec3<f32>;
var<private> singleScatteringMetallic : vec3<f32>;
var<private> multiScatteringMetallic : vec3<f32>;
var<private> nodeVar127 : vec3<f32>;
var<private> nodeVar128 : f32;
var<private> nodeVar129 : vec3<f32>;
var<private> nodeVar130 : vec3<f32>;
var<private> nodeVar131 : vec3<f32>;
var<private> nodeVar132 : vec3<f32>;
var<private> nodeVar133 : vec3<f32>;
var<private> nodeVar134 : vec3<f32>;
var<private> nodeVar135 : vec3<f32>;
var<private> nodeVar136 : f32;
var<private> nodeVar137 : f32;
var<private> nodeVar138 : f32;
var<private> nodeVar139 : vec3<f32>;
var<private> nodeVar140 : vec3<f32>;
var<private> nodeVar141 : vec3<f32>;
var<private> nodeVar142 : vec3<f32>;
var<private> nodeVar143 : vec3<f32>;
var<private> nodeVar144 : vec3<f32>;
var<private> nodeVar145 : vec3<f32>;
var<private> nodeVar146 : f32;
var<private> nodeVar147 : vec3<f32>;
var<private> nodeVar148 : vec3<f32>;
var<private> nodeVar149 : vec3<f32>;
var<private> nodeVar150 : vec3<f32>;
var<private> nodeVar151 : vec3<f32>;
var<private> nodeVar152 : vec3<f32>;
var<private> nodeVar153 : vec3<f32>;
var<private> nodeVar154 : f32;
var<private> nodeVar155 : f32;
var<private> nodeVar156 : f32;
var<private> nodeVar157 : vec3<f32>;
var<private> nodeVar158 : vec3<f32>;
var<private> nodeVar159 : vec3<f32>;
var<private> nodeVar160 : vec3<f32>;
var<private> nodeVar161 : vec3<f32>;
var<private> nodeVar162 : vec3<f32>;
var<private> nodeVar163 : vec3<f32>;
var<private> nodeVar164 : vec3<f32>;
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
var<private> indirectSpecular : vec3<f32>;
var<private> nodeVar176 : vec3<f32>;
var<private> nodeVar177 : vec3<f32>;
var<private> ambientOcclusion : f32;
var<private> nodeVar178 : vec3<f32>;
var<private> nodeVar179 : f32;
var<private> nodeVar180 : f32;
var<private> nodeVar181 : f32;
var<private> nodeVar182 : f32;
var<private> nodeVar183 : f32;
var<private> nodeVar184 : f32;
var<private> nodeVar185 : f32;
var<private> nodeVar186 : f32;
var<private> nodeVar187 : f32;
var<private> nodeVar188 : f32;
var<private> nodeVar189 : f32;
var<private> nodeVar190 : vec3<f32>;
var<private> totalDiffuse : vec3<f32>;
var<private> nodeVar191 : vec3<f32>;
var<private> totalSpecular : vec3<f32>;
var<private> nodeVar192 : vec3<f32>;
var<private> outgoingLight : vec3<f32>;
var<private> nodeVar193 : vec3<f32>;
var<private> nodeVar194 : vec4<f32>;

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
	@location( 1 ) v_positionViewDirection : vec3<f32>,
	@location( 2 ) v_positionWorld : vec3<f32> ) -> OutputStruct {

	// flow
	// code

	DiffuseColor = vec4<f32>( object.nodeUniform0, 1.0 );
	DiffuseColor.w = ( DiffuseColor.w * object.nodeUniform1 );
	DiffuseColor.w = 1.0;
	Metalness = object.nodeUniform2;
	normalViewGeometry = normalize( v_normalViewGeometry );
	nodeVar0 = max( abs( dpdx( normalViewGeometry ) ), abs( - dpdy( normalViewGeometry ) ) );
	Roughness = min( ( max( object.nodeUniform3, 0.0525 ) + max( max( nodeVar0.x, nodeVar0.y ), nodeVar0.z ) ), 1.0 );
	SpecularColor = vec3<f32>( 0.04, 0.04, 0.04 );
	SpecularColorBlended = mix( vec3<f32>( 0.04, 0.04, 0.04 ), DiffuseColor.xyz, Metalness );
	SpecularF90 = 1.0;
	DiffuseContribution = ( DiffuseColor.xyz * vec3<f32>( ( 1.0 - object.nodeUniform2 ) ) );
	EmissiveColor = ( object.nodeUniform6 * vec3<f32>( object.nodeUniform7 ) );
	NORMAL_normalView = normalViewGeometry;
	normalView = NORMAL_normalView;
	positionViewDirection = normalize( v_positionViewDirection );
	nodeVar1 = dot( normalView, positionViewDirection );
	nodeVar2 = textureSample( nodeUniform8, nodeUniform8_sampler, vec2<f32>( Roughness, clamp( nodeVar1, 0.0, 1.0 ) ) ).xy;
	let dfg = nodeVar2;
	nodeVar3 = ( dfg.x + dfg.y );
	nodeVar4 = ( 1.0 / nodeVar3 );
	nodeVar5 = nodeVar4;
	nodeVar6 = ( nodeVar5 - 1.0 );
	nodeVar7 = ( SpecularColorBlended * vec3<f32>( nodeVar6 ) );
	nodeVar8 = ( nodeVar7 + vec3<f32>( 1.0 ) );
	let multiScatteringCompensation = nodeVar8;
	nodeVar9 = ( render.nodeUniform11 - render.nodeUniform12 );
	nodeVar10 = vec4<f32>( nodeVar9, 0.0 );
	nodeVar11 = ( render.cameraViewMatrix * nodeVar10 );
	nodeVar12 = normalize( nodeVar11.xyz );
	nodeVar13 = nodeVar12;
	nodeVar14 = dot( normalView, nodeVar13 );
	shadowPositionWorld = v_positionWorld;
	normalWorld = normalize( ( vec4<f32>( normalView, 0.0 ) * render.cameraViewMatrix ).xyz );
	nodeVar16 = ( render.nodeUniform14 * vec4<f32>( ( shadowPositionWorld + ( normalWorld * vec3<f32>( render.nodeUniform15 ) ) ), 1.0 ) );
	nodeVar17 = ( nodeVar16.xyz / vec3<f32>( nodeVar16.w ) );
	nodeVar18 = vec3<f32>( nodeVar17.x, ( 1.0 - nodeVar17.y ), ( nodeVar17.z + render.nodeUniform16 ) );

	if ( ( ( ( ( ( nodeVar18.x >= 0.0 ) && ( nodeVar18.x <= 1.0 ) ) && ( nodeVar18.y >= 0.0 ) ) && ( nodeVar18.y <= 1.0 ) ) && ( nodeVar18.z <= 1.0 ) ) ) {

		nodeVar19 = ( vec2<f32>( 1.0, 1.0 ) / object.nodeUniform18 );
		nodeVar20 = ( nodeVar18.xy + ( nodeVar19 * vec2<f32>( -1.0, -1.0 ) ) );
		nodeVar21 = textureSampleCompare( nodeUniform17, nodeUniform17_sampler, nodeVar20, nodeVar18.z );
		nodeVar22 = ( nodeVar18.xy + ( nodeVar19 * vec2<f32>( 0.0, -1.0 ) ) );
		nodeVar23 = textureSampleCompare( nodeUniform17, nodeUniform17_sampler, nodeVar22, nodeVar18.z );
		nodeVar24 = ( nodeVar18.xy + ( nodeVar19 * vec2<f32>( 1.0, -1.0 ) ) );
		nodeVar25 = textureSampleCompare( nodeUniform17, nodeUniform17_sampler, nodeVar24, nodeVar18.z );
		nodeVar26 = ( nodeVar18.xy + ( nodeVar19 * vec2<f32>( -1.0, 0.0 ) ) );
		nodeVar27 = textureSampleCompare( nodeUniform17, nodeUniform17_sampler, nodeVar26, nodeVar18.z );
		nodeVar28 = ( nodeVar18.xy + ( nodeVar19 * vec2<f32>( 0.0, 0.0 ) ) );
		nodeVar29 = textureSampleCompare( nodeUniform17, nodeUniform17_sampler, nodeVar28, nodeVar18.z );
		nodeVar30 = ( nodeVar18.xy + ( nodeVar19 * vec2<f32>( 1.0, 0.0 ) ) );
		nodeVar31 = textureSampleCompare( nodeUniform17, nodeUniform17_sampler, nodeVar30, nodeVar18.z );
		nodeVar32 = ( nodeVar18.xy + ( nodeVar19 * vec2<f32>( -1.0, 1.0 ) ) );
		nodeVar33 = textureSampleCompare( nodeUniform17, nodeUniform17_sampler, nodeVar32, nodeVar18.z );
		nodeVar34 = ( nodeVar18.xy + ( nodeVar19 * vec2<f32>( 0.0, 1.0 ) ) );
		nodeVar35 = textureSampleCompare( nodeUniform17, nodeUniform17_sampler, nodeVar34, nodeVar18.z );
		nodeVar36 = ( nodeVar18.xy + ( nodeVar19 * vec2<f32>( 1.0, 1.0 ) ) );
		nodeVar37 = textureSampleCompare( nodeUniform17, nodeUniform17_sampler, nodeVar36, nodeVar18.z );
		nodeVar15 = ( ( ( ( ( ( ( ( ( ( 0.0 + nodeVar21 ) + nodeVar23 ) + nodeVar25 ) + nodeVar27 ) + nodeVar29 ) + nodeVar31 ) + nodeVar33 ) + nodeVar35 ) + nodeVar37 ) / 9.0 );

	} else {

		nodeVar15 = 1.0;

	}

	nodeVar38 = mix( 1.0, nodeVar15, render.nodeUniform19 );
	nodeVar39 = ( render.nodeUniform13 * vec3<f32>( nodeVar38 ) );
	nodeVar40 = ( vec3<f32>( clamp( nodeVar14, 0.0, 1.0 ) ) * nodeVar39 );
	nodeVar41 = nodeVar40;
	directDiffuse = vec3<f32>( 0.0, 0.0, 0.0 );
	nodeVar42 = ( DiffuseContribution * vec3<f32>( 0.3183098861837907 ) );
	nodeVar43 = ( nodeVar41 * nodeVar42 );
	nodeVar44 = ( nodeVar13 + positionViewDirection );
	nodeVar45 = normalize( nodeVar44 );
	nodeVar46 = dot( positionViewDirection, nodeVar45 );
	nodeVar47 = clamp( nodeVar46, 0.0, 1.0 );
	nodeVar48 = exp2( ( ( ( nodeVar47 * -5.55473 ) - 6.98316 ) * nodeVar47 ) );
	nodeVar49 = ( ( SpecularColor * vec3<f32>( ( 1.0 - nodeVar48 ) ) ) + vec3<f32>( ( SpecularF90 * nodeVar48 ) ) );
	nodeVar50 = ( vec3<f32>( 1.0 ) - nodeVar49 );
	nodeVar51 = nodeVar50;
	nodeVar52 = ( nodeVar43 * nodeVar51 );
	nodeVar53 = ( directDiffuse + nodeVar52 );
	directDiffuse = nodeVar53;
	directSpecular = vec3<f32>( 0.0, 0.0, 0.0 );
	nodeVar54 = normalize( ( nodeVar13 + positionViewDirection ) );
	nodeVar55 = clamp( dot( positionViewDirection, nodeVar54 ), 0.0, 1.0 );
	nodeVar56 = exp2( ( ( ( nodeVar55 * -5.55473 ) - 6.98316 ) * nodeVar55 ) );
	nodeVar57 = ( Roughness * Roughness );
	nodeVar58 = ( ( ( ( SpecularColorBlended * vec3<f32>( ( 1.0 - nodeVar56 ) ) ) + vec3<f32>( ( 1.0 * nodeVar56 ) ) ) * vec3<f32>( V_GGX_SmithCorrelated( nodeVar57, clamp( dot( normalView, nodeVar13 ), 0.0, 1.0 ), clamp( dot( normalView, positionViewDirection ), 0.0, 1.0 ) ) ) ) * vec3<f32>( D_GGX( nodeVar57, clamp( dot( normalView, nodeVar54 ), 0.0, 1.0 ) ) ) );
	nodeVar59 = ( nodeVar41 * nodeVar58 );
	nodeVar60 = ( nodeVar59 * multiScatteringCompensation );
	nodeVar61 = ( directSpecular + nodeVar60 );
	directSpecular = nodeVar61;
	radiance = vec3<f32>( 0.0, 0.0, 0.0 );
	nodeVar62 = clamp( roughnessToMip( Roughness ), -2.0, object.nodeUniform20 );
	nodeVar63 = floor( nodeVar62 );
	nodeVar64 = nodeVar63;
	nodeVar65 = normalize( ( render.cameraWorldMatrix * vec4<f32>( normalize( mix( reflect( ( - positionViewDirection ), normalView ), normalView, ( ( ( Roughness * Roughness ) * Roughness ) * Roughness ) ) ), 0.0 ) ).xyz );
	nodeVar66 = getFace( ( object.nodeUniform21 * vec4<f32>( vec3<f32>( nodeVar65.x, ( - nodeVar65.y ), nodeVar65.z ), 1.0 ) ).xyz );
	nodeVar67 = max( ( 4.0 - nodeVar64 ), 0.0 );
	nodeVar64 = max( nodeVar64, 4.0 );
	nodeVar68 = exp2( nodeVar64 );
	nodeVar69 = ( ( getUV( ( object.nodeUniform21 * vec4<f32>( vec3<f32>( nodeVar65.x, ( - nodeVar65.y ), nodeVar65.z ), 1.0 ) ).xyz, nodeVar66 ) * vec2<f32>( ( nodeVar68 - 2.0 ) ) ) + vec2<f32>( 1.0 ) );

	if ( ( nodeVar66 > 2.0 ) ) {

		nodeVar69.y = ( nodeVar69.y + nodeVar68 );
		nodeVar66 = ( nodeVar66 - 3.0 );
		

	}

	nodeVar69.x = ( nodeVar69.x + ( nodeVar66 * nodeVar68 ) );
	nodeVar69.x = ( nodeVar69.x + ( nodeVar67 * ( 3.0 * 16.0 ) ) );
	nodeVar69.y = ( nodeVar69.y + ( 4.0 * ( exp2( object.nodeUniform20 ) - nodeVar68 ) ) );
	nodeVar69.x = ( nodeVar69.x * object.nodeUniform23 );
	nodeVar69.y = ( nodeVar69.y * object.nodeUniform24 );
	nodeVar70 = textureSampleGrad( nodeUniform25, nodeUniform25_sampler, nodeVar69, vec2<f32>( 0.0, 0.0 ), vec2<f32>( 0.0, 0.0 ) );
	nodeVar71 = nodeVar70.xyz;
	nodeVar72 = fract( nodeVar62 );

	if ( ( nodeVar72 != 0.0 ) ) {

		nodeVar73 = ( nodeVar63 + 1.0 );
		nodeVar74 = getFace( ( object.nodeUniform21 * vec4<f32>( vec3<f32>( nodeVar65.x, ( - nodeVar65.y ), nodeVar65.z ), 1.0 ) ).xyz );
		nodeVar75 = max( ( 4.0 - nodeVar73 ), 0.0 );
		nodeVar73 = max( nodeVar73, 4.0 );
		nodeVar76 = exp2( nodeVar73 );
		nodeVar77 = ( ( getUV( ( object.nodeUniform21 * vec4<f32>( vec3<f32>( nodeVar65.x, ( - nodeVar65.y ), nodeVar65.z ), 1.0 ) ).xyz, nodeVar74 ) * vec2<f32>( ( nodeVar76 - 2.0 ) ) ) + vec2<f32>( 1.0 ) );

		if ( ( nodeVar74 > 2.0 ) ) {

			nodeVar77.y = ( nodeVar77.y + nodeVar76 );
			nodeVar74 = ( nodeVar74 - 3.0 );
			

		}

		nodeVar77.x = ( nodeVar77.x + ( nodeVar74 * nodeVar76 ) );
		nodeVar77.x = ( nodeVar77.x + ( nodeVar75 * ( 3.0 * 16.0 ) ) );
		nodeVar77.y = ( nodeVar77.y + ( 4.0 * ( exp2( object.nodeUniform20 ) - nodeVar76 ) ) );
		nodeVar77.x = ( nodeVar77.x * object.nodeUniform23 );
		nodeVar77.y = ( nodeVar77.y * object.nodeUniform24 );
		nodeVar78 = textureSampleGrad( nodeUniform25, nodeUniform25_sampler, nodeVar77, vec2<f32>( 0.0, 0.0 ), vec2<f32>( 0.0, 0.0 ) );
		nodeVar79 = nodeVar78.xyz;
		nodeVar71 = mix( nodeVar71, nodeVar79, nodeVar72 );
		

	}

	nodeVar80 = ( radiance + ( nodeVar71 * vec3<f32>( object.nodeUniform26 ) ) );
	radiance = nodeVar80;
	iblIrradiance = vec3<f32>( 0.0, 0.0, 0.0 );
	nodeVar81 = clamp( roughnessToMip( 1.0 ), -2.0, object.nodeUniform20 );
	nodeVar82 = floor( nodeVar81 );
	nodeVar83 = nodeVar82;
	nodeVar84 = getFace( ( object.nodeUniform21 * vec4<f32>( vec3<f32>( normalWorld.x, ( - normalWorld.y ), normalWorld.z ), 1.0 ) ).xyz );
	nodeVar85 = max( ( 4.0 - nodeVar83 ), 0.0 );
	nodeVar83 = max( nodeVar83, 4.0 );
	nodeVar86 = exp2( nodeVar83 );
	nodeVar87 = ( ( getUV( ( object.nodeUniform21 * vec4<f32>( vec3<f32>( normalWorld.x, ( - normalWorld.y ), normalWorld.z ), 1.0 ) ).xyz, nodeVar84 ) * vec2<f32>( ( nodeVar86 - 2.0 ) ) ) + vec2<f32>( 1.0 ) );

	if ( ( nodeVar84 > 2.0 ) ) {

		nodeVar87.y = ( nodeVar87.y + nodeVar86 );
		nodeVar84 = ( nodeVar84 - 3.0 );
		

	}

	nodeVar87.x = ( nodeVar87.x + ( nodeVar84 * nodeVar86 ) );
	nodeVar87.x = ( nodeVar87.x + ( nodeVar85 * ( 3.0 * 16.0 ) ) );
	nodeVar87.y = ( nodeVar87.y + ( 4.0 * ( exp2( object.nodeUniform20 ) - nodeVar86 ) ) );
	nodeVar87.x = ( nodeVar87.x * object.nodeUniform23 );
	nodeVar87.y = ( nodeVar87.y * object.nodeUniform24 );
	nodeVar88 = textureSampleGrad( nodeUniform25, nodeUniform25_sampler, nodeVar87, vec2<f32>( 0.0, 0.0 ), vec2<f32>( 0.0, 0.0 ) );
	nodeVar89 = nodeVar88.xyz;
	nodeVar90 = fract( nodeVar81 );

	if ( ( nodeVar90 != 0.0 ) ) {

		nodeVar91 = ( nodeVar82 + 1.0 );
		nodeVar92 = getFace( ( object.nodeUniform21 * vec4<f32>( vec3<f32>( normalWorld.x, ( - normalWorld.y ), normalWorld.z ), 1.0 ) ).xyz );
		nodeVar93 = max( ( 4.0 - nodeVar91 ), 0.0 );
		nodeVar91 = max( nodeVar91, 4.0 );
		nodeVar94 = exp2( nodeVar91 );
		nodeVar95 = ( ( getUV( ( object.nodeUniform21 * vec4<f32>( vec3<f32>( normalWorld.x, ( - normalWorld.y ), normalWorld.z ), 1.0 ) ).xyz, nodeVar92 ) * vec2<f32>( ( nodeVar94 - 2.0 ) ) ) + vec2<f32>( 1.0 ) );

		if ( ( nodeVar92 > 2.0 ) ) {

			nodeVar95.y = ( nodeVar95.y + nodeVar94 );
			nodeVar92 = ( nodeVar92 - 3.0 );
			

		}

		nodeVar95.x = ( nodeVar95.x + ( nodeVar92 * nodeVar94 ) );
		nodeVar95.x = ( nodeVar95.x + ( nodeVar93 * ( 3.0 * 16.0 ) ) );
		nodeVar95.y = ( nodeVar95.y + ( 4.0 * ( exp2( object.nodeUniform20 ) - nodeVar94 ) ) );
		nodeVar95.x = ( nodeVar95.x * object.nodeUniform23 );
		nodeVar95.y = ( nodeVar95.y * object.nodeUniform24 );
		nodeVar96 = textureSampleGrad( nodeUniform25, nodeUniform25_sampler, nodeVar95, vec2<f32>( 0.0, 0.0 ), vec2<f32>( 0.0, 0.0 ) );
		nodeVar97 = nodeVar96.xyz;
		nodeVar89 = mix( nodeVar89, nodeVar97, nodeVar90 );
		

	}

	nodeVar98 = ( iblIrradiance + ( ( nodeVar89 * vec3<f32>( 3.141592653589793 ) ) * vec3<f32>( object.nodeUniform26 ) ) );
	iblIrradiance = nodeVar98;
	nodeVar99 = vec3<f32>( 0.0, 0.0, 0.0 );
	nodeVar100 = vec3<f32>( 0.0, 0.0, 0.0 );
	nodeVar101 = ( SpecularColor * vec3<f32>( dfg.x ) );
	nodeVar102 = ( SpecularF90 * dfg.y );
	nodeVar103 = ( nodeVar101 + vec3<f32>( nodeVar102 ) );
	nodeVar104 = ( nodeVar99 + nodeVar103 );
	nodeVar99 = nodeVar104;
	nodeVar105 = ( vec3<f32>( 1.0 ) - SpecularColor );
	nodeVar106 = nodeVar105;
	nodeVar107 = ( nodeVar106 * vec3<f32>( 0.047619 ) );
	nodeVar108 = ( SpecularColor + nodeVar107 );
	nodeVar109 = ( nodeVar103 * nodeVar108 );
	nodeVar110 = ( dfg.x + dfg.y );
	nodeVar111 = ( 1.0 - nodeVar110 );
	nodeVar112 = nodeVar111;
	nodeVar113 = ( vec3<f32>( nodeVar112 ) * nodeVar108 );
	nodeVar114 = ( vec3<f32>( 1.0 ) - nodeVar113 );
	nodeVar115 = nodeVar114;
	nodeVar116 = ( nodeVar109 / nodeVar115 );
	nodeVar117 = ( nodeVar116 * vec3<f32>( nodeVar112 ) );
	nodeVar118 = ( nodeVar100 + nodeVar117 );
	nodeVar100 = nodeVar118;
	irradiance = vec3<f32>( 0.0, 0.0, 0.0 );
	nodeVar119 = ( DiffuseContribution * vec3<f32>( 0.3183098861837907 ) );
	nodeVar120 = ( irradiance * nodeVar119 );
	nodeVar121 = ( nodeVar99 + nodeVar100 );
	nodeVar122 = ( vec3<f32>( 1.0 ) - nodeVar121 );
	nodeVar123 = nodeVar122;
	nodeVar124 = ( nodeVar120 * nodeVar123 );
	nodeVar125 = nodeVar124;
	indirectDiffuse = vec3<f32>( 0.0, 0.0, 0.0 );
	nodeVar126 = ( indirectDiffuse + nodeVar125 );
	indirectDiffuse = nodeVar126;
	singleScatteringDielectric = vec3<f32>( 0.0, 0.0, 0.0 );
	multiScatteringDielectric = vec3<f32>( 0.0, 0.0, 0.0 );
	singleScatteringMetallic = vec3<f32>( 0.0, 0.0, 0.0 );
	multiScatteringMetallic = vec3<f32>( 0.0, 0.0, 0.0 );
	nodeVar127 = ( SpecularColor * vec3<f32>( dfg.x ) );
	nodeVar128 = ( SpecularF90 * dfg.y );
	nodeVar129 = ( nodeVar127 + vec3<f32>( nodeVar128 ) );
	nodeVar130 = ( singleScatteringDielectric + nodeVar129 );
	singleScatteringDielectric = nodeVar130;
	nodeVar131 = ( vec3<f32>( 1.0 ) - SpecularColor );
	nodeVar132 = nodeVar131;
	nodeVar133 = ( nodeVar132 * vec3<f32>( 0.047619 ) );
	nodeVar134 = ( SpecularColor + nodeVar133 );
	nodeVar135 = ( nodeVar129 * nodeVar134 );
	nodeVar136 = ( dfg.x + dfg.y );
	nodeVar137 = ( 1.0 - nodeVar136 );
	nodeVar138 = nodeVar137;
	nodeVar139 = ( vec3<f32>( nodeVar138 ) * nodeVar134 );
	nodeVar140 = ( vec3<f32>( 1.0 ) - nodeVar139 );
	nodeVar141 = nodeVar140;
	nodeVar142 = ( nodeVar135 / nodeVar141 );
	nodeVar143 = ( nodeVar142 * vec3<f32>( nodeVar138 ) );
	nodeVar144 = ( multiScatteringDielectric + nodeVar143 );
	multiScatteringDielectric = nodeVar144;
	nodeVar145 = ( DiffuseColor.xyz * vec3<f32>( dfg.x ) );
	nodeVar146 = ( SpecularF90 * dfg.y );
	nodeVar147 = ( nodeVar145 + vec3<f32>( nodeVar146 ) );
	nodeVar148 = ( singleScatteringMetallic + nodeVar147 );
	singleScatteringMetallic = nodeVar148;
	nodeVar149 = ( vec3<f32>( 1.0 ) - DiffuseColor.xyz );
	nodeVar150 = nodeVar149;
	nodeVar151 = ( nodeVar150 * vec3<f32>( 0.047619 ) );
	nodeVar152 = ( DiffuseColor.xyz + nodeVar151 );
	nodeVar153 = ( nodeVar147 * nodeVar152 );
	nodeVar154 = ( dfg.x + dfg.y );
	nodeVar155 = ( 1.0 - nodeVar154 );
	nodeVar156 = nodeVar155;
	nodeVar157 = ( vec3<f32>( nodeVar156 ) * nodeVar152 );
	nodeVar158 = ( vec3<f32>( 1.0 ) - nodeVar157 );
	nodeVar159 = nodeVar158;
	nodeVar160 = ( nodeVar153 / nodeVar159 );
	nodeVar161 = ( nodeVar160 * vec3<f32>( nodeVar156 ) );
	nodeVar162 = ( multiScatteringMetallic + nodeVar161 );
	multiScatteringMetallic = nodeVar162;
	nodeVar163 = mix( singleScatteringDielectric, singleScatteringMetallic, Metalness );
	nodeVar164 = ( radiance * nodeVar163 );
	nodeVar165 = mix( multiScatteringDielectric, multiScatteringMetallic, Metalness );
	nodeVar166 = ( iblIrradiance * vec3<f32>( 0.3183098861837907 ) );
	nodeVar167 = ( nodeVar165 * nodeVar166 );
	nodeVar168 = ( nodeVar164 + nodeVar167 );
	nodeVar169 = nodeVar168;
	nodeVar170 = ( singleScatteringDielectric + multiScatteringDielectric );
	nodeVar171 = ( vec3<f32>( 1.0 ) - nodeVar170 );
	nodeVar172 = nodeVar171;
	nodeVar173 = ( DiffuseContribution * nodeVar172 );
	nodeVar174 = ( nodeVar173 * nodeVar166 );
	nodeVar175 = nodeVar174;
	indirectSpecular = vec3<f32>( 0.0, 0.0, 0.0 );
	nodeVar176 = ( indirectSpecular + nodeVar169 );
	indirectSpecular = nodeVar176;
	nodeVar177 = ( indirectDiffuse + nodeVar175 );
	indirectDiffuse = nodeVar177;
	ambientOcclusion = 1.0;
	nodeVar178 = ( indirectDiffuse * vec3<f32>( ambientOcclusion ) );
	indirectDiffuse = nodeVar178;
	nodeVar179 = dot( normalView, positionViewDirection );
	nodeVar180 = ( clamp( nodeVar179, 0.0, 1.0 ) + ambientOcclusion );
	nodeVar181 = ( Roughness * -16.0 );
	nodeVar182 = ( 1.0 - nodeVar181 );
	nodeVar183 = nodeVar182;
	nodeVar184 = ( - nodeVar183 );
	nodeVar185 = exp2( nodeVar184 );
	nodeVar186 = pow( nodeVar180, nodeVar185 );
	nodeVar187 = ( 1.0 - nodeVar186 );
	nodeVar188 = nodeVar187;
	nodeVar189 = ( ambientOcclusion - nodeVar188 );
	nodeVar190 = ( indirectSpecular * vec3<f32>( clamp( nodeVar189, 0.0, 1.0 ) ) );
	indirectSpecular = nodeVar190;
	nodeVar191 = ( directDiffuse + indirectDiffuse );
	totalDiffuse = nodeVar191;
	nodeVar192 = ( directSpecular + indirectSpecular );
	totalSpecular = nodeVar192;
	nodeVar193 = ( totalDiffuse + totalSpecular );
	outgoingLight = nodeVar193;
	nodeVar194 = max( vec4<f32>( ( outgoingLight + EmissiveColor ), DiffuseColor.w ), vec4<f32>( 0.0 ) );
	Output = nodeVar194;

	// result

	output.color = nodeVar194;

	return output;

}
