// Three.js r186 - Node System

// directives


// structs


// uniforms

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

// varyings

struct VaryingsStruct {
	@location( 0 ) v_normalViewGeometry : vec3<f32>,
	@location( 1 ) v_tangentView : vec3<f32>,
	@location( 2 ) v_bitangentView : vec3<f32>,
	@location( 3 ) v_positionViewDirection : vec3<f32>,
	@location( 4 ) v_positionWorld : vec3<f32>,
	@location( 5 ) NORMAL_v_bitangentView : vec3<f32>,
	@location( 6 ) nodeVarying10 : vec2<f32>,
	@builtin( position ) builtinClipSpace : vec4<f32>
};
var<private> varyings : VaryingsStruct;

// vars
var<private> normalLocal : vec3<f32>;
var<private> nodeVar4 : vec3<f32>;
var<private> modelViewMatrix : mat4x4<f32>;
var<private> tangentLocal : vec3<f32>;
var<private> normalViewGeometry : vec3<f32>;
var<private> VERTEX_normalView : vec3<f32>;
var<private> VERTEX_tangentView : vec3<f32>;
var<private> VERTEX_nodeVar203 : vec4<f32>;
var<private> v_modelViewProjection : vec4<f32>;
var<private> v_positionView : vec3<f32>;
var<private> positionLocal : vec3<f32>;
var<private> VERTEX_v_modelViewProjection : vec4<f32>;

// codes


@vertex
fn main( @location( 0 ) uv : vec2<f32>,
	@location( 1 ) normal : vec3<f32>,
	@location( 2 ) tangent : vec4<f32>,
	@location( 3 ) position : vec3<f32> ) -> VaryingsStruct {

	// flow
	// code

	varyings.nodeVarying10 = uv;
	normalLocal = normal;
	nodeVar4 = normalize( ( render.cameraViewMatrix * vec4<f32>( ( object.nodeUniform12 * normalLocal ), 0.0 ) ).xyz );
	varyings.v_normalViewGeometry = nodeVar4;
	modelViewMatrix = ( render.cameraViewMatrix * object.nodeUniform18 );
	tangentLocal = tangent.xyz;
	varyings.v_tangentView = ( modelViewMatrix * vec4<f32>( tangentLocal, 0.0 ) ).xyz;
	normalViewGeometry = normalize( varyings.v_normalViewGeometry );
	VERTEX_normalView = normalViewGeometry;
	VERTEX_tangentView = normalize( varyings.v_tangentView );
	varyings.NORMAL_v_bitangentView = ( cross( VERTEX_normalView, VERTEX_tangentView ) * vec3<f32>( tangent.w ) );
	positionLocal = position;
	v_positionView = ( modelViewMatrix * vec4<f32>( positionLocal, 1.0 ) ).xyz;
	varyings.v_positionViewDirection = ( - v_positionView );
	varyings.v_positionWorld = ( object.nodeUniform18 * vec4<f32>( positionLocal, 1.0 ) ).xyz;
	VERTEX_nodeVar203 = ( render.cameraProjectionMatrix * vec4<f32>( v_positionView, 1.0 ) );
	VERTEX_v_modelViewProjection = VERTEX_nodeVar203;

	// result

	varyings.builtinClipSpace = VERTEX_v_modelViewProjection;

	return varyings;

}
