// Three.js r186 - Node System

// global
diagnostic( off, derivative_uniformity );


// structs

struct OutputStruct {
	@location( 0 ) color: vec4<f32>
};
var<private> output : OutputStruct;

// uniforms
@binding( 0 ) @group( 1 ) var nodeUniform0_sampler : sampler;
@binding( 1 ) @group( 1 ) var nodeUniform0 : texture_2d<f32>;

// vars
var<private> nodeVar0 : vec3<f32>;
var<private> nodeVar1 : vec4<f32>;

// codes


@fragment
fn main( @location( 0 ) nodeVarying4 : vec3<f32> ) -> OutputStruct {

	// flow
	// code

	nodeVar0 = normalize( nodeVarying4 );
	nodeVar1 = textureSampleLevel( nodeUniform0, nodeUniform0_sampler, vec2<f32>( ( ( atan2( nodeVar0.z, nodeVar0.x ) * 0.15915494309189535 ) + 0.5 ), ( ( asin( clamp( nodeVar0.y, -1.0, 1.0 ) ) * 0.3183098861837907 ) + 0.5 ) ), 0.0 );

	// result

	output.color = nodeVar1;

	return output;

}
