// Three.js r186 - Node System

// global
diagnostic( off, derivative_uniformity );


// structs

struct OutputStruct {
	@location( 0 ) color: vec4<f32>
};
var<private> output : OutputStruct;

// uniforms
@binding( 1 ) @group( 1 ) var nodeUniform2_sampler : sampler;
@binding( 2 ) @group( 1 ) var nodeUniform2 : texture_2d<f32>;

struct objectStruct {
	nodeUniform0 : f32,
	nodeUniform1 : f32,
	nodeUniform5 : mat4x4<f32>
};
@binding( 0 ) @group( 1 )
var<uniform> object : objectStruct;

// vars
var<private> nodeVar0 : vec3<f32>;
var<private> nodeVar1 : vec3<f32>;
var<private> nodeVar2 : f32;
var<private> nodeVar3 : f32;
var<private> nodeVar4 : f32;
var<private> nodeVar5 : f32;
var<private> nodeVar6 : f32;
var<private> nodeVar7 : vec2<f32>;
var<private> nodeVar8 : vec4<f32>;
var<private> nodeVar9 : vec3<f32>;
var<private> nodeVar10 : vec3<f32>;
var<private> nodeVar11 : vec3<f32>;
var<private> nodeVar12 : u32;
var<private> nodeVar13 : vec2<f32>;
var<private> nodeVar14 : f32;
var<private> nodeVar15 : vec3<f32>;
var<private> nodeVar16 : vec3<f32>;
var<private> nodeVar17 : vec3<f32>;
var<private> nodeVar18 : vec3<f32>;
var<private> nodeVar19 : f32;
var<private> nodeVar20 : f32;
var<private> nodeVar21 : f32;
var<private> nodeVar22 : f32;
var<private> nodeVar23 : f32;
var<private> nodeVar24 : vec2<f32>;
var<private> nodeVar25 : vec4<f32>;

// codes
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
fn main( @location( 0 ) nodeVarying4 : vec3<f32> ) -> OutputStruct {

	// flow
	// code

	nodeVar0 = normalize( nodeVarying4 );
	nodeVar1 = vec3<f32>( 0.0, 0.0, 0.0 );
	nodeVar2 = 0.0;

	if ( ( object.nodeUniform0 < 0.001 ) ) {

		nodeVar3 = object.nodeUniform1;
		nodeVar4 = getFace( nodeVar0 );
		nodeVar5 = max( ( 4.0 - nodeVar3 ), 0.0 );
		nodeVar3 = max( nodeVar3, 4.0 );
		nodeVar6 = exp2( nodeVar3 );
		nodeVar7 = ( ( getUV( nodeVar0, nodeVar4 ) * vec2<f32>( ( nodeVar6 - 2.0 ) ) ) + vec2<f32>( 1.0 ) );

		if ( ( nodeVar4 > 2.0 ) ) {

			nodeVar7.y = ( nodeVar7.y + nodeVar6 );
			nodeVar4 = ( nodeVar4 - 3.0 );
			

		}

		nodeVar7.x = ( nodeVar7.x + ( nodeVar4 * nodeVar6 ) );
		nodeVar7.x = ( nodeVar7.x + ( nodeVar5 * ( 3.0 * 16.0 ) ) );
		nodeVar7.y = ( nodeVar7.y + ( 4.0 * ( exp2( 7.0 ) - nodeVar6 ) ) );
		nodeVar7.x = ( nodeVar7.x * 0.0026041666666666665 );
		nodeVar7.y = ( nodeVar7.y * 0.001953125 );
		nodeVar8 = textureSampleGrad( nodeUniform2, nodeUniform2_sampler, nodeVar7, vec2<f32>( 0.0, 0.0 ), vec2<f32>( 0.0, 0.0 ) );
		nodeVar1 = nodeVar8.xyz;
		

	} else {


		if ( ( abs( nodeVar0.z ) < 0.999 ) ) {

			nodeVar9 = vec3<f32>( 0.0, 0.0, 1.0 );

		} else {

			nodeVar9 = vec3<f32>( 1.0, 0.0, 0.0 );

		}

		nodeVar10 = normalize( cross( nodeVar9, nodeVar0 ) );
		nodeVar11 = cross( nodeVar0, nodeVar10 );

		for ( var i : i32 = 0; i < 256; i ++ ) {

			let nodeConst0 = ( object.nodeUniform0 * object.nodeUniform0 );
			let nodeConst1 = vec3<f32>( 1.0, 0.0, 0.0 );
			let nodeConst2 = cross( vec3<f32>( 0.0, 0.0, 1.0 ), nodeConst1 );
			nodeVar12 = u32( i );
			nodeVar12 = ( ( nodeVar12 << 16u ) | ( nodeVar12 >> 16u ) );
			nodeVar12 = ( ( ( nodeVar12 & 1431655765u ) << 1u ) | ( ( nodeVar12 & 2863311530u ) >> 1u ) );
			nodeVar12 = ( ( ( nodeVar12 & 858993459u ) << 2u ) | ( ( nodeVar12 & 3435973836u ) >> 2u ) );
			nodeVar12 = ( ( ( nodeVar12 & 252645135u ) << 4u ) | ( ( nodeVar12 & 4042322160u ) >> 4u ) );
			nodeVar12 = ( ( ( nodeVar12 & 16711935u ) << 8u ) | ( ( nodeVar12 & 4278255360u ) >> 8u ) );
			nodeVar13 = vec2<f32>( ( f32( i ) / 256.0 ), ( f32( nodeVar12 ) * 2.3283064365386963e-10 ) );
			let nodeConst3 = sqrt( nodeVar13.x );
			let nodeConst4 = ( ( 2.0 * 3.14159265359 ) * nodeVar13.y );
			let nodeConst5 = ( nodeConst3 * cos( nodeConst4 ) );
			nodeVar14 = ( nodeConst3 * sin( nodeConst4 ) );
			let nodeConst6 = ( 0.5 * ( vec3<f32>( 0.0, 0.0, 1.0 ).z + 1.0 ) );
			nodeVar14 = ( ( ( 1.0 - nodeConst6 ) * sqrt( ( 1.0 - ( nodeConst5 * nodeConst5 ) ) ) ) + ( nodeConst6 * nodeVar14 ) );
			nodeVar15 = ( ( ( nodeConst1 * vec3<f32>( nodeConst5 ) ) + ( nodeConst2 * vec3<f32>( nodeVar14 ) ) ) + ( vec3<f32>( 0.0, 0.0, 1.0 ) * vec3<f32>( sqrt( max( 0.0, ( 1.0 - ( ( nodeConst5 * nodeConst5 ) + ( nodeVar14 * nodeVar14 ) ) ) ) ) ) ) );
			nodeVar16 = normalize( vec3<f32>( ( nodeConst0 * nodeVar15.x ), ( nodeConst0 * nodeVar15.y ), max( 0.0, nodeVar15.z ) ) );
			nodeVar17 = normalize( ( ( ( nodeVar10 * vec3<f32>( nodeVar16.x ) ) + ( nodeVar11 * vec3<f32>( nodeVar16.y ) ) ) + ( nodeVar0 * vec3<f32>( nodeVar16.z ) ) ) );
			nodeVar18 = normalize( ( ( nodeVar17 * vec3<f32>( ( dot( nodeVar0, nodeVar17 ) * 2.0 ) ) ) - nodeVar0 ) );
			nodeVar19 = max( dot( nodeVar0, nodeVar18 ), 0.0 );

			if ( ( nodeVar19 > 0.0 ) ) {

				nodeVar20 = object.nodeUniform1;
				nodeVar21 = getFace( nodeVar18 );
				nodeVar22 = max( ( 4.0 - nodeVar20 ), 0.0 );
				nodeVar20 = max( nodeVar20, 4.0 );
				nodeVar23 = exp2( nodeVar20 );
				nodeVar24 = ( ( getUV( nodeVar18, nodeVar21 ) * vec2<f32>( ( nodeVar23 - 2.0 ) ) ) + vec2<f32>( 1.0 ) );

				if ( ( nodeVar21 > 2.0 ) ) {

					nodeVar24.y = ( nodeVar24.y + nodeVar23 );
					nodeVar21 = ( nodeVar21 - 3.0 );
					

				}

				nodeVar24.x = ( nodeVar24.x + ( nodeVar21 * nodeVar23 ) );
				nodeVar24.x = ( nodeVar24.x + ( nodeVar22 * ( 3.0 * 16.0 ) ) );
				nodeVar24.y = ( nodeVar24.y + ( 4.0 * ( exp2( 7.0 ) - nodeVar23 ) ) );
				nodeVar24.x = ( nodeVar24.x * 0.0026041666666666665 );
				nodeVar24.y = ( nodeVar24.y * 0.001953125 );
				nodeVar25 = textureSampleGrad( nodeUniform2, nodeUniform2_sampler, nodeVar24, vec2<f32>( 0.0, 0.0 ), vec2<f32>( 0.0, 0.0 ) );
				nodeVar1 = ( vec4<f32>( nodeVar1, 1.0 ) + ( nodeVar25 * vec4<f32>( nodeVar19 ) ) ).xyz;
				nodeVar2 = ( nodeVar2 + nodeVar19 );
				

			}


		}


		if ( ( nodeVar2 > 0.0 ) ) {

			nodeVar1 = ( nodeVar1 / vec3<f32>( nodeVar2 ) );
			

		}

		

	}


	// result

	output.color = vec4<f32>( nodeVar1, 1.0 );

	return output;

}
