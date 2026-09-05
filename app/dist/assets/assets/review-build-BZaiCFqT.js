import{O as e}from"./v4-BJmWi5kg.js";import{c as t,d as n,i as r,n as i,o as a,r as o}from"./helpers-z9v0JHte.js";import{A as s,B as c,C as l,D as u,E as d,F as f,G as p,H as m,I as h,L as g,M as _,N as v,O as y,P as ee,R as b,S as x,T as S,U as C,V as w,W as T,_ as E,a as te,b as ne,c as re,d as ie,f as ae,g as oe,h as D,i as se,j as O,k as ce,l as le,m as k,n as ue,o as de,p as A,r as fe,s as pe,t as me,u as he,v as ge,w as j,x as _e,y as ve,z as ye}from"./use-paged-build-DwX-ilMD.js";import{i as be,n as xe,r as Se,t as Ce}from"./maximize-2-mOkU6x6e.js";import{n as we,r as Te,t as Ee}from"./x-De2f5xR8.js";import{n as De,t as Oe}from"./circle-check-r6gchvZf.js";import{i as ke,n as Ae,r as je,t as Me}from"./resource-pack-B4c4fQQK.js";var Ne=parseInt(`179`.replace(/\D+/g,``)),Pe=Ne>=125?`uv1`:`uv2`,Fe=new _e,M=new C,N=class extends d{constructor(){super(),this.isLineSegmentsGeometry=!0,this.type=`LineSegmentsGeometry`,this.setIndex([0,2,1,2,3,1,2,4,3,4,5,3,4,6,5,6,7,5]),this.setAttribute(`position`,new S([-1,2,0,1,2,0,-1,1,0,1,1,0,-1,0,0,1,0,0,-1,-1,0,1,-1,0],3)),this.setAttribute(`uv`,new S([-1,2,1,2,-1,1,1,1,-1,-1,1,-1,-1,-2,1,-2],2))}applyMatrix4(e){let t=this.attributes.instanceStart,n=this.attributes.instanceEnd;return t!==void 0&&(t.applyMatrix4(e),n.applyMatrix4(e),t.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}setPositions(e){let t;e instanceof Float32Array?t=e:Array.isArray(e)&&(t=new Float32Array(e));let n=new u(t,6,1);return this.setAttribute(`instanceStart`,new y(n,3,0)),this.setAttribute(`instanceEnd`,new y(n,3,3)),this.computeBoundingBox(),this.computeBoundingSphere(),this}setColors(e,t=3){let n;e instanceof Float32Array?n=e:Array.isArray(e)&&(n=new Float32Array(e));let r=new u(n,t*2,1);return this.setAttribute(`instanceColorStart`,new y(r,t,0)),this.setAttribute(`instanceColorEnd`,new y(r,t,t)),this}fromWireframeGeometry(e){return this.setPositions(e.attributes.position.array),this}fromEdgesGeometry(e){return this.setPositions(e.attributes.position.array),this}fromMesh(e){return this.fromWireframeGeometry(new p(e.geometry)),this}fromLineSegments(e){let t=e.geometry;return this.setPositions(t.attributes.position.array),this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new _e);let e=this.attributes.instanceStart,t=this.attributes.instanceEnd;e!==void 0&&t!==void 0&&(this.boundingBox.setFromBufferAttribute(e),Fe.setFromBufferAttribute(t),this.boundingBox.union(Fe))}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new ye),this.boundingBox===null&&this.computeBoundingBox();let e=this.attributes.instanceStart,t=this.attributes.instanceEnd;if(e!==void 0&&t!==void 0){let n=this.boundingSphere.center;this.boundingBox.getCenter(n);let r=0;for(let i=0,a=e.count;i<a;i++)M.fromBufferAttribute(e,i),r=Math.max(r,n.distanceToSquared(M)),M.fromBufferAttribute(t,i),r=Math.max(r,n.distanceToSquared(M));this.boundingSphere.radius=Math.sqrt(r),isNaN(this.boundingSphere.radius)&&console.error(`THREE.LineSegmentsGeometry.computeBoundingSphere(): Computed radius is NaN. The instanced position data is likely to have NaN values.`,this)}}toJSON(){}applyMatrix(e){return console.warn(`THREE.LineSegmentsGeometry: applyMatrix() has been renamed to applyMatrix4().`),this.applyMatrix4(e)}},P=class extends N{constructor(){super(),this.isLineGeometry=!0,this.type=`LineGeometry`}setPositions(e){let t=e.length-3,n=new Float32Array(2*t);for(let r=0;r<t;r+=3)n[2*r]=e[r],n[2*r+1]=e[r+1],n[2*r+2]=e[r+2],n[2*r+3]=e[r+3],n[2*r+4]=e[r+4],n[2*r+5]=e[r+5];return super.setPositions(n),this}setColors(e,t=3){let n=e.length-t,r=new Float32Array(2*n);if(t===3)for(let i=0;i<n;i+=t)r[2*i]=e[i],r[2*i+1]=e[i+1],r[2*i+2]=e[i+2],r[2*i+3]=e[i+3],r[2*i+4]=e[i+4],r[2*i+5]=e[i+5];else for(let i=0;i<n;i+=t)r[2*i]=e[i],r[2*i+1]=e[i+1],r[2*i+2]=e[i+2],r[2*i+3]=e[i+3],r[2*i+4]=e[i+4],r[2*i+5]=e[i+5],r[2*i+6]=e[i+6],r[2*i+7]=e[i+7];return super.setColors(r,t),this}fromLine(e){let t=e.geometry;return this.setPositions(t.attributes.position.array),this}},F=class extends b{constructor(e){super({type:`LineMaterial`,uniforms:w.clone(w.merge([ne.common,ne.fog,{worldUnits:{value:1},linewidth:{value:1},resolution:{value:new m(1,1)},dashOffset:{value:0},dashScale:{value:1},dashSize:{value:1},gapSize:{value:1}}])),vertexShader:`
				#include <common>
				#include <fog_pars_vertex>
				#include <logdepthbuf_pars_vertex>
				#include <clipping_planes_pars_vertex>

				uniform float linewidth;
				uniform vec2 resolution;

				attribute vec3 instanceStart;
				attribute vec3 instanceEnd;

				#ifdef USE_COLOR
					#ifdef USE_LINE_COLOR_ALPHA
						varying vec4 vLineColor;
						attribute vec4 instanceColorStart;
						attribute vec4 instanceColorEnd;
					#else
						varying vec3 vLineColor;
						attribute vec3 instanceColorStart;
						attribute vec3 instanceColorEnd;
					#endif
				#endif

				#ifdef WORLD_UNITS

					varying vec4 worldPos;
					varying vec3 worldStart;
					varying vec3 worldEnd;

					#ifdef USE_DASH

						varying vec2 vUv;

					#endif

				#else

					varying vec2 vUv;

				#endif

				#ifdef USE_DASH

					uniform float dashScale;
					attribute float instanceDistanceStart;
					attribute float instanceDistanceEnd;
					varying float vLineDistance;

				#endif

				void trimSegment( const in vec4 start, inout vec4 end ) {

					// trim end segment so it terminates between the camera plane and the near plane

					// conservative estimate of the near plane
					float a = projectionMatrix[ 2 ][ 2 ]; // 3nd entry in 3th column
					float b = projectionMatrix[ 3 ][ 2 ]; // 3nd entry in 4th column
					float nearEstimate = - 0.5 * b / a;

					float alpha = ( nearEstimate - start.z ) / ( end.z - start.z );

					end.xyz = mix( start.xyz, end.xyz, alpha );

				}

				void main() {

					#ifdef USE_COLOR

						vLineColor = ( position.y < 0.5 ) ? instanceColorStart : instanceColorEnd;

					#endif

					#ifdef USE_DASH

						vLineDistance = ( position.y < 0.5 ) ? dashScale * instanceDistanceStart : dashScale * instanceDistanceEnd;
						vUv = uv;

					#endif

					float aspect = resolution.x / resolution.y;

					// camera space
					vec4 start = modelViewMatrix * vec4( instanceStart, 1.0 );
					vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );

					#ifdef WORLD_UNITS

						worldStart = start.xyz;
						worldEnd = end.xyz;

					#else

						vUv = uv;

					#endif

					// special case for perspective projection, and segments that terminate either in, or behind, the camera plane
					// clearly the gpu firmware has a way of addressing this issue when projecting into ndc space
					// but we need to perform ndc-space calculations in the shader, so we must address this issue directly
					// perhaps there is a more elegant solution -- WestLangley

					bool perspective = ( projectionMatrix[ 2 ][ 3 ] == - 1.0 ); // 4th entry in the 3rd column

					if ( perspective ) {

						if ( start.z < 0.0 && end.z >= 0.0 ) {

							trimSegment( start, end );

						} else if ( end.z < 0.0 && start.z >= 0.0 ) {

							trimSegment( end, start );

						}

					}

					// clip space
					vec4 clipStart = projectionMatrix * start;
					vec4 clipEnd = projectionMatrix * end;

					// ndc space
					vec3 ndcStart = clipStart.xyz / clipStart.w;
					vec3 ndcEnd = clipEnd.xyz / clipEnd.w;

					// direction
					vec2 dir = ndcEnd.xy - ndcStart.xy;

					// account for clip-space aspect ratio
					dir.x *= aspect;
					dir = normalize( dir );

					#ifdef WORLD_UNITS

						// get the offset direction as perpendicular to the view vector
						vec3 worldDir = normalize( end.xyz - start.xyz );
						vec3 offset;
						if ( position.y < 0.5 ) {

							offset = normalize( cross( start.xyz, worldDir ) );

						} else {

							offset = normalize( cross( end.xyz, worldDir ) );

						}

						// sign flip
						if ( position.x < 0.0 ) offset *= - 1.0;

						float forwardOffset = dot( worldDir, vec3( 0.0, 0.0, 1.0 ) );

						// don't extend the line if we're rendering dashes because we
						// won't be rendering the endcaps
						#ifndef USE_DASH

							// extend the line bounds to encompass  endcaps
							start.xyz += - worldDir * linewidth * 0.5;
							end.xyz += worldDir * linewidth * 0.5;

							// shift the position of the quad so it hugs the forward edge of the line
							offset.xy -= dir * forwardOffset;
							offset.z += 0.5;

						#endif

						// endcaps
						if ( position.y > 1.0 || position.y < 0.0 ) {

							offset.xy += dir * 2.0 * forwardOffset;

						}

						// adjust for linewidth
						offset *= linewidth * 0.5;

						// set the world position
						worldPos = ( position.y < 0.5 ) ? start : end;
						worldPos.xyz += offset;

						// project the worldpos
						vec4 clip = projectionMatrix * worldPos;

						// shift the depth of the projected points so the line
						// segments overlap neatly
						vec3 clipPose = ( position.y < 0.5 ) ? ndcStart : ndcEnd;
						clip.z = clipPose.z * clip.w;

					#else

						vec2 offset = vec2( dir.y, - dir.x );
						// undo aspect ratio adjustment
						dir.x /= aspect;
						offset.x /= aspect;

						// sign flip
						if ( position.x < 0.0 ) offset *= - 1.0;

						// endcaps
						if ( position.y < 0.0 ) {

							offset += - dir;

						} else if ( position.y > 1.0 ) {

							offset += dir;

						}

						// adjust for linewidth
						offset *= linewidth;

						// adjust for clip-space to screen-space conversion // maybe resolution should be based on viewport ...
						offset /= resolution.y;

						// select end
						vec4 clip = ( position.y < 0.5 ) ? clipStart : clipEnd;

						// back to clip space
						offset *= clip.w;

						clip.xy += offset;

					#endif

					gl_Position = clip;

					vec4 mvPosition = ( position.y < 0.5 ) ? start : end; // this is an approximation

					#include <logdepthbuf_vertex>
					#include <clipping_planes_vertex>
					#include <fog_vertex>

				}
			`,fragmentShader:`
				uniform vec3 diffuse;
				uniform float opacity;
				uniform float linewidth;

				#ifdef USE_DASH

					uniform float dashOffset;
					uniform float dashSize;
					uniform float gapSize;

				#endif

				varying float vLineDistance;

				#ifdef WORLD_UNITS

					varying vec4 worldPos;
					varying vec3 worldStart;
					varying vec3 worldEnd;

					#ifdef USE_DASH

						varying vec2 vUv;

					#endif

				#else

					varying vec2 vUv;

				#endif

				#include <common>
				#include <fog_pars_fragment>
				#include <logdepthbuf_pars_fragment>
				#include <clipping_planes_pars_fragment>

				#ifdef USE_COLOR
					#ifdef USE_LINE_COLOR_ALPHA
						varying vec4 vLineColor;
					#else
						varying vec3 vLineColor;
					#endif
				#endif

				vec2 closestLineToLine(vec3 p1, vec3 p2, vec3 p3, vec3 p4) {

					float mua;
					float mub;

					vec3 p13 = p1 - p3;
					vec3 p43 = p4 - p3;

					vec3 p21 = p2 - p1;

					float d1343 = dot( p13, p43 );
					float d4321 = dot( p43, p21 );
					float d1321 = dot( p13, p21 );
					float d4343 = dot( p43, p43 );
					float d2121 = dot( p21, p21 );

					float denom = d2121 * d4343 - d4321 * d4321;

					float numer = d1343 * d4321 - d1321 * d4343;

					mua = numer / denom;
					mua = clamp( mua, 0.0, 1.0 );
					mub = ( d1343 + d4321 * ( mua ) ) / d4343;
					mub = clamp( mub, 0.0, 1.0 );

					return vec2( mua, mub );

				}

				void main() {

					#include <clipping_planes_fragment>

					#ifdef USE_DASH

						if ( vUv.y < - 1.0 || vUv.y > 1.0 ) discard; // discard endcaps

						if ( mod( vLineDistance + dashOffset, dashSize + gapSize ) > dashSize ) discard; // todo - FIX

					#endif

					float alpha = opacity;

					#ifdef WORLD_UNITS

						// Find the closest points on the view ray and the line segment
						vec3 rayEnd = normalize( worldPos.xyz ) * 1e5;
						vec3 lineDir = worldEnd - worldStart;
						vec2 params = closestLineToLine( worldStart, worldEnd, vec3( 0.0, 0.0, 0.0 ), rayEnd );

						vec3 p1 = worldStart + lineDir * params.x;
						vec3 p2 = rayEnd * params.y;
						vec3 delta = p1 - p2;
						float len = length( delta );
						float norm = len / linewidth;

						#ifndef USE_DASH

							#ifdef USE_ALPHA_TO_COVERAGE

								float dnorm = fwidth( norm );
								alpha = 1.0 - smoothstep( 0.5 - dnorm, 0.5 + dnorm, norm );

							#else

								if ( norm > 0.5 ) {

									discard;

								}

							#endif

						#endif

					#else

						#ifdef USE_ALPHA_TO_COVERAGE

							// artifacts appear on some hardware if a derivative is taken within a conditional
							float a = vUv.x;
							float b = ( vUv.y > 0.0 ) ? vUv.y - 1.0 : vUv.y + 1.0;
							float len2 = a * a + b * b;
							float dlen = fwidth( len2 );

							if ( abs( vUv.y ) > 1.0 ) {

								alpha = 1.0 - smoothstep( 1.0 - dlen, 1.0 + dlen, len2 );

							}

						#else

							if ( abs( vUv.y ) > 1.0 ) {

								float a = vUv.x;
								float b = ( vUv.y > 0.0 ) ? vUv.y - 1.0 : vUv.y + 1.0;
								float len2 = a * a + b * b;

								if ( len2 > 1.0 ) discard;

							}

						#endif

					#endif

					vec4 diffuseColor = vec4( diffuse, alpha );
					#ifdef USE_COLOR
						#ifdef USE_LINE_COLOR_ALPHA
							diffuseColor *= vLineColor;
						#else
							diffuseColor.rgb *= vLineColor;
						#endif
					#endif

					#include <logdepthbuf_fragment>

					gl_FragColor = diffuseColor;

					#include <tonemapping_fragment>
					#include <${Ne>=154?`colorspace_fragment`:`encodings_fragment`}>
					#include <fog_fragment>
					#include <premultiplied_alpha_fragment>

				}
			`,clipping:!0}),this.isLineMaterial=!0,this.onBeforeCompile=function(){this.transparent?this.defines.USE_LINE_COLOR_ALPHA=`1`:delete this.defines.USE_LINE_COLOR_ALPHA},Object.defineProperties(this,{color:{enumerable:!0,get:function(){return this.uniforms.diffuse.value},set:function(e){this.uniforms.diffuse.value=e}},worldUnits:{enumerable:!0,get:function(){return`WORLD_UNITS`in this.defines},set:function(e){e===!0?this.defines.WORLD_UNITS=``:delete this.defines.WORLD_UNITS}},linewidth:{enumerable:!0,get:function(){return this.uniforms.linewidth.value},set:function(e){this.uniforms.linewidth.value=e}},dashed:{enumerable:!0,get:function(){return`USE_DASH`in this.defines},set(e){!!e!=`USE_DASH`in this.defines&&(this.needsUpdate=!0),e===!0?this.defines.USE_DASH=``:delete this.defines.USE_DASH}},dashScale:{enumerable:!0,get:function(){return this.uniforms.dashScale.value},set:function(e){this.uniforms.dashScale.value=e}},dashSize:{enumerable:!0,get:function(){return this.uniforms.dashSize.value},set:function(e){this.uniforms.dashSize.value=e}},dashOffset:{enumerable:!0,get:function(){return this.uniforms.dashOffset.value},set:function(e){this.uniforms.dashOffset.value=e}},gapSize:{enumerable:!0,get:function(){return this.uniforms.gapSize.value},set:function(e){this.uniforms.gapSize.value=e}},opacity:{enumerable:!0,get:function(){return this.uniforms.opacity.value},set:function(e){this.uniforms.opacity.value=e}},resolution:{enumerable:!0,get:function(){return this.uniforms.resolution.value},set:function(e){this.uniforms.resolution.value.copy(e)}},alphaToCoverage:{enumerable:!0,get:function(){return`USE_ALPHA_TO_COVERAGE`in this.defines},set:function(e){!!e!=`USE_ALPHA_TO_COVERAGE`in this.defines&&(this.needsUpdate=!0),e===!0?(this.defines.USE_ALPHA_TO_COVERAGE=``,this.extensions.derivatives=!0):(delete this.defines.USE_ALPHA_TO_COVERAGE,this.extensions.derivatives=!1)}}}),this.setValues(e)}},I=new T,Ie=new C,L=new C,R=new T,z=new T,B=new T,Le=new C,Re=new O,V=new ce,ze=new C,Be=new _e,Ve=new ye,H=new T,U,W;function He(e,t,n){return H.set(0,0,-t,1).applyMatrix4(e.projectionMatrix),H.multiplyScalar(1/H.w),H.x=W/n.width,H.y=W/n.height,H.applyMatrix4(e.projectionMatrixInverse),H.multiplyScalar(1/H.w),Math.abs(Math.max(H.x,H.y))}function Ue(e,t){let n=e.matrixWorld,r=e.geometry,i=r.attributes.instanceStart,a=r.attributes.instanceEnd,o=Math.min(r.instanceCount,i.count);for(let r=0,s=o;r<s;r++){V.start.fromBufferAttribute(i,r),V.end.fromBufferAttribute(a,r),V.applyMatrix4(n);let o=new C,s=new C;U.distanceSqToSegment(V.start,V.end,s,o),s.distanceTo(o)<W*.5&&t.push({point:s,pointOnLine:o,distance:U.origin.distanceTo(s),object:e,face:null,faceIndex:r,uv:null,[Pe]:null})}}function We(e,t,n){let r=t.projectionMatrix,i=e.material.resolution,a=e.matrixWorld,o=e.geometry,c=o.attributes.instanceStart,l=o.attributes.instanceEnd,u=Math.min(o.instanceCount,c.count),d=-t.near;U.at(1,B),B.w=1,B.applyMatrix4(t.matrixWorldInverse),B.applyMatrix4(r),B.multiplyScalar(1/B.w),B.x*=i.x/2,B.y*=i.y/2,B.z=0,Le.copy(B),Re.multiplyMatrices(t.matrixWorldInverse,a);for(let t=0,o=u;t<o;t++){if(R.fromBufferAttribute(c,t),z.fromBufferAttribute(l,t),R.w=1,z.w=1,R.applyMatrix4(Re),z.applyMatrix4(Re),R.z>d&&z.z>d)continue;if(R.z>d){let e=R.z-z.z,t=(R.z-d)/e;R.lerp(z,t)}else if(z.z>d){let e=z.z-R.z,t=(z.z-d)/e;z.lerp(R,t)}R.applyMatrix4(r),z.applyMatrix4(r),R.multiplyScalar(1/R.w),z.multiplyScalar(1/z.w),R.x*=i.x/2,R.y*=i.y/2,z.x*=i.x/2,z.y*=i.y/2,V.start.copy(R),V.start.z=0,V.end.copy(z),V.end.z=0;let o=V.closestPointToPointParameter(Le,!0);V.at(o,ze);let u=s.lerp(R.z,z.z,o),f=u>=-1&&u<=1,p=Le.distanceTo(ze)<W*.5;if(f&&p){V.start.fromBufferAttribute(c,t),V.end.fromBufferAttribute(l,t),V.start.applyMatrix4(a),V.end.applyMatrix4(a);let r=new C,i=new C;U.distanceSqToSegment(V.start,V.end,i,r),n.push({point:i,pointOnLine:r,distance:U.origin.distanceTo(i),object:e,face:null,faceIndex:t,uv:null,[Pe]:null})}}}var Ge=class extends _{constructor(e=new N,t=new F({color:Math.random()*16777215})){super(e,t),this.isLineSegments2=!0,this.type=`LineSegments2`}computeLineDistances(){let e=this.geometry,t=e.attributes.instanceStart,n=e.attributes.instanceEnd,r=new Float32Array(2*t.count);for(let e=0,i=0,a=t.count;e<a;e++,i+=2)Ie.fromBufferAttribute(t,e),L.fromBufferAttribute(n,e),r[i]=i===0?0:r[i-1],r[i+1]=r[i]+Ie.distanceTo(L);let i=new u(r,2,1);return e.setAttribute(`instanceDistanceStart`,new y(i,1,0)),e.setAttribute(`instanceDistanceEnd`,new y(i,1,1)),this}raycast(e,t){let n=this.material.worldUnits,r=e.camera;r===null&&!n&&console.error(`LineSegments2: "Raycaster.camera" needs to be set in order to raycast against LineSegments2 while worldUnits is set to false.`);let i=e.params.Line2===void 0?0:e.params.Line2.threshold||0;U=e.ray;let a=this.matrixWorld,o=this.geometry,s=this.material;W=s.linewidth+i,o.boundingSphere===null&&o.computeBoundingSphere(),Ve.copy(o.boundingSphere).applyMatrix4(a);let c;if(c=n?W*.5:He(r,Math.max(r.near,Ve.distanceToPoint(U.origin)),s.resolution),Ve.radius+=c,U.intersectsSphere(Ve)===!1)return;o.boundingBox===null&&o.computeBoundingBox(),Be.copy(o.boundingBox).applyMatrix4(a);let l;l=n?W*.5:He(r,Math.max(r.near,Be.distanceToPoint(U.origin)),s.resolution),Be.expandByScalar(l),U.intersectsBox(Be)!==!1&&(n?Ue(this,t):We(this,r,t))}onBeforeRender(e){let t=this.material.uniforms;t&&t.resolution&&(e.getViewport(I),this.material.uniforms.resolution.value.set(I.z,I.w))}},Ke=class extends Ge{constructor(e=new P,t=new F({color:Math.random()*16777215})){super(e,t),this.isLine2=!0,this.type=`Line2`}},G=e(n()),qe=G.forwardRef(function({points:e,color:t=16777215,vertexColors:n,linewidth:r,lineWidth:i,segments:a,dashed:o,...s},c){var l;let u=ve(e=>e.size),d=G.useMemo(()=>a?new Ge:new Ke,[a]),[f]=G.useState(()=>new F),p=(n==null||(l=n[0])==null?void 0:l.length)===4?4:3,h=G.useMemo(()=>{let r=a?new N:new P,i=e.map(e=>{let t=Array.isArray(e);return e instanceof C||e instanceof T?[e.x,e.y,e.z]:e instanceof m?[e.x,e.y,0]:t&&e.length===3?[e[0],e[1],e[2]]:t&&e.length===2?[e[0],e[1],0]:e});if(r.setPositions(i.flat()),n){t=16777215;let e=n.map(e=>e instanceof x?e.toArray():e);r.setColors(e.flat(),p)}return r},[e,a,n,p]);return G.useLayoutEffect(()=>{d.computeLineDistances()},[e,d]),G.useLayoutEffect(()=>{o?f.defines.USE_DASH=``:delete f.defines.USE_DASH,f.needsUpdate=!0},[o,f]),G.useEffect(()=>()=>{h.dispose(),f.dispose()},[h]),G.createElement(`primitive`,E({object:d,ref:c},s),G.createElement(`primitive`,{object:h,attach:`geometry`}),G.createElement(`primitive`,E({object:f,attach:`material`,color:t,vertexColors:!!n,resolution:[u.width,u.height],linewidth:r??i??1,dashed:o,transparent:p===4},s)))}),K=G.forwardRef(({threshold:e=15,geometry:t,...n},r)=>{let i=G.useRef(null);G.useImperativeHandle(r,()=>i.current,[]);let a=G.useMemo(()=>[0,0,0,1,0,0],[]),o=G.useRef(null),s=G.useRef(null);return G.useLayoutEffect(()=>{let n=i.current.parent,r=t??n?.geometry;if(!r||o.current===r&&s.current===e)return;o.current=r,s.current=e;let a=new l(r,e).attributes.position.array;i.current.geometry.setPositions(a),i.current.geometry.attributes.instanceStart.needsUpdate=!0,i.current.geometry.attributes.instanceEnd.needsUpdate=!0,i.current.computeLineDistances()}),G.createElement(qe,E({segments:!0,points:a,ref:i,raycast:()=>null},n))});function Je(e,t){let n=e+`Geometry`;return G.forwardRef(({args:e,children:r,...i},a)=>{let o=G.useRef(null);return G.useImperativeHandle(a,()=>o.current),G.useLayoutEffect(()=>void t?.(o.current)),G.createElement(`mesh`,E({ref:o},i),G.createElement(n,{attach:`geometry`,args:e}),r)})}var Ye=Je(`box`),Xe=o(`circle-question-mark`,[[`circle`,{cx:`12`,cy:`12`,r:`10`,key:`1mglay`}],[`path`,{d:`M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3`,key:`1u773s`}],[`path`,{d:`M12 17h.01`,key:`p32p05`}]]),Ze=o(`circle`,[[`circle`,{cx:`12`,cy:`12`,r:`10`,key:`1mglay`}]]),Qe=o(`clipboard`,[[`rect`,{width:`8`,height:`4`,x:`8`,y:`2`,rx:`1`,ry:`1`,key:`tgr4d6`}],[`path`,{d:`M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2`,key:`116196`}]]),$e=o(`crosshair`,[[`circle`,{cx:`12`,cy:`12`,r:`10`,key:`1mglay`}],[`line`,{x1:`22`,x2:`18`,y1:`12`,y2:`12`,key:`l9bcsi`}],[`line`,{x1:`6`,x2:`2`,y1:`12`,y2:`12`,key:`13hhkx`}],[`line`,{x1:`12`,x2:`12`,y1:`6`,y2:`2`,key:`10w3f3`}],[`line`,{x1:`12`,x2:`12`,y1:`22`,y2:`18`,key:`15g9kq`}]]),et=o(`file-input`,[[`path`,{d:`M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4`,key:`1pf5j1`}],[`path`,{d:`M14 2v4a2 2 0 0 0 2 2h4`,key:`tnqrlb`}],[`path`,{d:`M2 15h10`,key:`jfw4w8`}],[`path`,{d:`m9 18 3-3-3-3`,key:`112psh`}]]),tt=o(`focus`,[[`circle`,{cx:`12`,cy:`12`,r:`3`,key:`1v7zrd`}],[`path`,{d:`M3 7V5a2 2 0 0 1 2-2h2`,key:`aa7l1z`}],[`path`,{d:`M17 3h2a2 2 0 0 1 2 2v2`,key:`4qcy5o`}],[`path`,{d:`M21 17v2a2 2 0 0 1-2 2h-2`,key:`6vwrx8`}],[`path`,{d:`M7 21H5a2 2 0 0 1-2-2v-2`,key:`ioqczr`}]]),nt=o(`locate-fixed`,[[`line`,{x1:`2`,x2:`5`,y1:`12`,y2:`12`,key:`bvdh0s`}],[`line`,{x1:`19`,x2:`22`,y1:`12`,y2:`12`,key:`1tbv5k`}],[`line`,{x1:`12`,x2:`12`,y1:`2`,y2:`5`,key:`11lu5j`}],[`line`,{x1:`12`,x2:`12`,y1:`19`,y2:`22`,key:`x3vr5v`}],[`circle`,{cx:`12`,cy:`12`,r:`7`,key:`fim9np`}],[`circle`,{cx:`12`,cy:`12`,r:`3`,key:`1v7zrd`}]]),rt=o(`orbit`,[[`path`,{d:`M20.341 6.484A10 10 0 0 1 10.266 21.85`,key:`1enhxb`}],[`path`,{d:`M3.659 17.516A10 10 0 0 1 13.74 2.152`,key:`1crzgf`}],[`circle`,{cx:`12`,cy:`12`,r:`3`,key:`1v7zrd`}],[`circle`,{cx:`19`,cy:`5`,r:`2`,key:`mhkx31`}],[`circle`,{cx:`5`,cy:`19`,r:`2`,key:`v8kfzx`}]]),it=o(`pen-line`,[[`path`,{d:`M13 21h8`,key:`1jsn5i`}],[`path`,{d:`M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z`,key:`1a8usu`}]]),at=o(`rotate-ccw`,[[`path`,{d:`M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8`,key:`1357e3`}],[`path`,{d:`M3 3v5h5`,key:`1xhq8a`}]]),ot=o(`search`,[[`path`,{d:`m21 21-4.34-4.34`,key:`14j7rj`}],[`circle`,{cx:`11`,cy:`11`,r:`8`,key:`4ej97u`}]]),st=o(`trash-2`,[[`path`,{d:`M10 11v6`,key:`nco0om`}],[`path`,{d:`M14 11v6`,key:`outv1u`}],[`path`,{d:`M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6`,key:`miytrc`}],[`path`,{d:`M3 6h18`,key:`d0wm0j`}],[`path`,{d:`M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2`,key:`e791ji`}]]),ct=o(`undo-2`,[[`path`,{d:`M9 14 4 9l5-5`,key:`102s5s`}],[`path`,{d:`M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11`,key:`f3b9sd`}]]),lt=[`change`,`fix`,`remove`,`liked`],ut=1e6,dt=4e3;function ft(e){return typeof e==`object`&&!!e&&!Array.isArray(e)}function pt(e){return ft(e)&&[e.x,e.y,e.z].every(e=>typeof e==`number`&&Number.isSafeInteger(e))}function q(e,t){return e.x>=t.min.x&&e.x<=t.max.x&&e.y>=t.min.y&&e.y<=t.max.y&&e.z>=t.min.z&&e.z<=t.max.z}function J(e){return e.min.x<=e.max.x&&e.min.y<=e.max.y&&e.min.z<=e.max.z}function mt(e){return JSON.stringify(Object.entries(e??{}).sort(([e],[t])=>e.localeCompare(t)))}function ht(e){return ft(e)&&Object.keys(e).length<=64&&Object.entries(e).every(([e,t])=>e.length>0&&e.length<=100&&(typeof t==`boolean`||typeof t==`number`&&Number.isFinite(t)||typeof t==`string`&&t.length<=256))}function gt(e){return typeof e==`string`&&e.length<=64&&Number.isFinite(Date.parse(e))}function Y(e){throw Error(`Invalid review: ${e}`)}function _t(e,t){return e.placements.reduce((e,n)=>e+ +!!q(n,t),0)}function vt(e,t){let n=e.max.x-e.min.x+1,r=e.max.y-e.min.y+1,i=e.max.z-e.min.z+1,a=Math.max(0,n*r*i);return{width:n,height:r,depth:i,volume:a,blockCount:t,density:a?t/a:0}}function yt(e){let t=e.max.x-e.min.x,n=e.max.y-e.min.y,r=e.max.z-e.min.z;return{dx:t,dy:n,dz:r,horizontal:Math.hypot(t,r),direct:Math.hypot(t,n,r),manhattan:Math.abs(t)+Math.abs(n)+Math.abs(r)}}function bt(e){let t=e.trim(),n=t.match(/^(-?\d+)\s*(?:,|\s)\s*(-?\d+)\s*(?:,|\s)\s*(-?\d+)$/)??t.match(/^x\s*=\s*(-?\d+)\s*[,; ]+y\s*=\s*(-?\d+)\s*[,; ]+z\s*=\s*(-?\d+)$/i)??t.match(/^\/?tp\s+(?:@[pares](?:\[[^\]]*\])?\s+)?(-?\d+)\s+(-?\d+)\s+(-?\d+)$/i);if(!n)return;let[r,i,a]=n.slice(1).map(Number);return[r,i,a].every(Number.isSafeInteger)?{x:r,y:i,z:a}:void 0}function xt(e,t){let n=t.trim().toLowerCase().replace(/^minecraft:/,``);if(n.length<2)return{matches:[],capped:!1,tooShort:!!n};let r=[],i=!1;for(let t of e){let e=t.block.replace(`minecraft:`,``),a=Object.entries(t.state??{}).sort(([e],[t])=>e.localeCompare(t)).map(([e,t])=>`${e}=${String(t)}`).join(` `);if(`${e} ${e.replaceAll(`_`,` `)} ${t.phase} ${a}`.toLowerCase().includes(n)){if(r.length===500){i=!0;break}r.push(t)}}return{matches:r,capped:i,tooShort:!1}}function St(e,t){let n=typeof e.reviewBuildId==`string`,r=typeof e.reviewBuildHash==`string`;return!n&&!r?`unbound`:!n||!r?`different`:e.reviewBuildId===t.id&&e.reviewBuildHash===t.hash?`current`:`different`}function Ct(e,t){let n=`review_${(t??globalThis.crypto?.randomUUID?.()??`${Date.now().toString(36)}_${Math.random().toString(36).slice(2,12)}`).replace(/[^A-Za-z0-9._:]/g,`_`).slice(0,96)||`annotation`}`,r=new Set(e);if(!r.has(n))return n;let i=2;for(;r.has(`${n}_${i}`);)i+=1;return`${n}_${i}`}function wt(e,t,n){if(e.length>=500)return;let r=Ct(e.map(e=>e.id),n);return[{...t,id:r},...e]}function Tt(e,t){ft(e)||Y(`the JSON root must be an object.`),(e.type!==`blockwright-review`||e.schemaVersion!==1)&&Y(`unsupported type or schema version.`),(!ft(e.build)||e.build.hash!==t.hash)&&Y(`the immutable build hash does not match this build.`),(typeof e.build.id!=`string`||e.build.id!==t.id)&&Y(`the build id does not match this build.`),Array.isArray(e.annotations)||Y(`annotations must be an array.`),e.annotations.length>500&&Y(`at most 500 annotations may be imported at once.`),e.annotations.length*t.placements.length>12e6&&Y(`this annotation/build combination is too large to validate safely in the reviewer; split the review into smaller files.`);let n=new Set;return e.annotations.map((e,r)=>{let i=`annotation ${r+1}`;ft(e)||Y(`${i} must be an object.`),(typeof e.id!=`string`||!/^[A-Za-z0-9._:-]{1,128}$/.test(e.id))&&Y(`${i} has an invalid id.`),n.has(e.id)&&Y(`${i} repeats id ${e.id}.`),n.add(e.id),(typeof e.category!=`string`||!lt.includes(e.category))&&Y(`${i} has an unsupported category.`),(typeof e.note!=`string`||e.note.length>4e3)&&Y(`${i} has an invalid or oversized note.`),gt(e.createdAt)||Y(`${i} has an invalid createdAt timestamp.`),e.updatedAt!==void 0&&!gt(e.updatedAt)&&Y(`${i} has an invalid updatedAt timestamp.`),e.resolved!==void 0&&typeof e.resolved!=`boolean`&&Y(`${i} has an invalid resolved flag.`),(!ft(e.bounds)||!pt(e.bounds.min)||!pt(e.bounds.max))&&Y(`${i} bounds must contain exact integer coordinates.`);let a={min:{...e.bounds.min},max:{...e.bounds.max}};J(a)||Y(`${i} bounds are reversed.`),(!q(a.min,t.bounds)||!q(a.max,t.bounds))&&Y(`${i} is outside the immutable build bounds.`);let o=_t(t,a);if((typeof e.blockCount!=`number`||!Number.isSafeInteger(e.blockCount)||e.blockCount!==o)&&Y(`${i} block count does not match the canonical build.`),e.pickedBlock!==void 0&&(typeof e.pickedBlock!=`string`||e.pickedBlock.length>200)&&Y(`${i} has an invalid picked block.`),e.pickedState!==void 0&&!ht(e.pickedState)&&Y(`${i} has an invalid picked state.`),e.pickedState!==void 0&&e.pickedBlock===void 0&&Y(`${i} has block state without a picked block.`),e.pickedBlock!==void 0){let n=e.pickedState===void 0?void 0:mt(e.pickedState);t.placements.some(t=>q(t,a)&&t.block===e.pickedBlock&&(n===void 0||mt(t.state)===n))||Y(`${i} picked block or state is not canonical within its bounds.`)}return{id:e.id,category:e.category,note:e.note,bounds:a,blockCount:e.blockCount,...e.pickedBlock===void 0?{}:{pickedBlock:e.pickedBlock},...e.pickedState===void 0?{}:{pickedState:{...e.pickedState}},createdAt:e.createdAt,...e.resolved===void 0?{}:{resolved:e.resolved},...e.updatedAt===void 0?{}:{updatedAt:e.updatedAt}}})}function Et(e,t){let n=t?.input.rolePalette?.roof;return e.block===n||/roof|eave|ridge|gable|tile|finial|soffit/i.test(e.phase)||/roof_tile/.test(e.block)}var Dt=`blockwright-reviewer-3d-lease-v1`,Ot=`blockwright:reviewer:3d-lease:v1`,kt=`blockwright-reviewer-3d-active`;function At(e,t){return e&&t===`fullscreen`}function jt(e,t=Date.now()){return{type:kt,token:e,activatedAt:t}}function Mt(e,t){if(!e||typeof e!=`object`)return!1;let n=e;return n.type===`blockwright-reviewer-3d-active`&&typeof n.token==`string`&&n.token.length>0&&n.token!==t&&typeof n.activatedAt==`number`&&Number.isFinite(n.activatedAt)}function Nt(e,t=4){let n=Object.entries(e).sort(([,e],[,t])=>t-e||0),r=Number.isSafeInteger(t)&&t>0?t:4;return{materialCount:n.length,visible:n.slice(0,r),hiddenCount:Math.max(0,n.length-r)}}var Pt=new Set([`north`,`south`,`west`,`east`]),Ft={0:`east`,1:`west`,2:`south`,3:`north`},It={north:[0,-1],south:[0,1],west:[-1,0],east:[1,0]},Lt={north:0,east:-Math.PI/2,south:Math.PI,west:Math.PI/2};function Rt(e,t,n,r){let i=new O,a=new h().setFromEuler(new j(0,n.rotationY??0,0));for(let r=0;r<t.length;r+=1){let o=t[r];i.compose(new C(o.x+n.offset[0],o.y+n.offset[1],o.z+n.offset[2]),a,new C(...n.size)),e.setMatrixAt(r,i)}e.instanceMatrix.needsUpdate=!0,e.computeBoundingSphere(),r()}var zt={white:`#f0f1ec`,light_gray:`#a7adaf`,gray:`#596166`,black:`#202329`,brown:`#74472f`,red:`#b53b38`,orange:`#e47725`,yellow:`#dfc43b`,lime:`#75b83d`,green:`#3f7d48`,cyan:`#278c9b`,light_blue:`#58a8d3`,blue:`#385ba6`,purple:`#7749a3`,magenta:`#b64c9d`,pink:`#e38da7`},Bt=Object.keys(zt).sort((e,t)=>t.length-e.length);function X(e,t){return e.state?.[t]}function Vt(e,t=!1){return e===!0||e===1||e===`true`||e===`1`?!0:e===!1||e===0||e===`false`||e===`0`?!1:t}function Ht(e,t=`north`){return typeof e==`string`&&Pt.has(e)?e:t}function Ut(e,t=`north`){let n=typeof e==`number`?e:Number(e);return Number.isInteger(n)?Ft[n]??t:t}function Wt(e,t){let n=t===`bedrock`,r=e.block,i=r.endsWith(`_stairs`)?X(e,`weirdo_direction`):X(e,`direction`),a=n?/_door$/.test(r)&&!/_trapdoor$/.test(r)?Ht(X(e,`minecraft:cardinal_direction`)):Ut(i):Ht(X(e,`facing`)),o=n?Vt(X(e,`upside_down_bit`)):X(e,`half`)===`top`,s=X(e,`minecraft:vertical_half`),c=/_double_slab$/.test(r)?`double`:n?s===`top`?`top`:`bottom`:X(e,`type`)===`double`?`double`:X(e,`type`)===`top`?`top`:`bottom`;return{facing:a,half:o?`top`:`bottom`,hinge:n?Vt(X(e,`door_hinge_bit`))?`right`:`left`:X(e,`hinge`)===`right`?`right`:`left`,doorHalf:n?Vt(X(e,`upper_block_bit`))?`upper`:`lower`:X(e,`half`)===`upper`?`upper`:`lower`,open:Vt(n?X(e,`open_bit`):X(e,`open`)),hanging:Vt(X(e,`hanging`)),slabType:c}}function Gt(e){return[1,3,5].map(t=>Number.parseInt(e.slice(t,t+2),16))}function Kt(e,t,n){let r=Gt(e),i=Gt(t);return`#${r.map((e,t)=>Math.round(e+(i[t]-e)*n).toString(16).padStart(2,`0`)).join(``)}`}function qt(e,t,n){let r=t/100,i=n/100,a=(1-Math.abs(2*i-1))*r,o=e/60,s=a*(1-Math.abs(o%2-1)),[c,l,u]=o<1?[a,s,0]:o<2?[s,a,0]:o<3?[0,a,s]:o<4?[0,s,a]:o<5?[s,0,a]:[a,0,s],d=i-a/2;return`#${[c,l,u].map(e=>Math.round((e+d)*255).toString(16).padStart(2,`0`)).join(``)}`}function Jt(e){let t=2166136261;for(let n=0;n<e.length;n+=1)t^=e.charCodeAt(n),t=Math.imul(t,16777619);return qt(Math.abs(t)%360,24+Math.abs(t>>>8)%19,48+Math.abs(t>>>16)%13)}function Yt(e){let t=e.toLowerCase().replace(/^minecraft:/,``);if(/concrete|wool|terracotta|stained_glass|carpet|candle|shulker_box/.test(t)){let e=Bt.find(e=>RegExp(`(?:^|_)${e}(?:_|$)`).test(t));if(e){let n=zt[e];return/terracotta/.test(t)&&!/glazed/.test(t)?Kt(n,`#7d4c3d`,.36):/glazed_terracotta/.test(t)?Kt(n,`#f0e2d3`,.12):/wool|carpet/.test(t)?Kt(n,`#ebe7dd`,.08):/stained_glass/.test(t)?Kt(n,`#d9f1f2`,.18):/concrete_powder/.test(t)?Kt(n,`#eadfcf`,.1):n}}return/water|bubble_column/.test(t)?`#2387cf`:/packed_ice|blue_ice/.test(t)?`#68b7e6`:/ice/.test(t)?`#a4d8e5`:/glass|pane/.test(t)?`#a7d2d7`:/sea_lantern|lantern|glowstone|froglight|shroomlight|ochre_froglight/.test(t)?`#efba55`:/redstone|magma/.test(t)?`#b84332`:/diamond/.test(t)?`#55d7ce`:/emerald/.test(t)?`#42b86b`:/lapis/.test(t)?`#3659a9`:/gold/.test(t)?`#d7ac35`:/netherite/.test(t)?`#39353a`:/oxidized_copper/.test(t)?`#4f9a83`:/weathered_copper/.test(t)?`#65927c`:/exposed_copper/.test(t)?`#ad7958`:/copper/.test(t)?`#b96342`:/iron|chain|anvil|hopper|cauldron/.test(t)?`#8b9292`:/deepslate|blackstone|coal|basalt/.test(t)?`#30383d`:/quartz|calcite|diorite|bone_block/.test(t)?`#d8d3c6`:/prismarine/.test(t)?`#559687`:/sandstone|sand|end_stone/.test(t)?`#cbb67b`:/granite|brick/.test(t)?`#8d5545`:/stone|tuff|andesite|cobble|gravel/.test(t)?`#747a78`:/warped/.test(t)?`#347b76`:/crimson/.test(t)?`#7c354d`:/mangrove/.test(t)?`#703d32`:/cherry/.test(t)?`#d39a9a`:/spruce|dark_oak/.test(t)?`#49311f`:/jungle|acacia/.test(t)?`#9a5d36`:/oak|bamboo|birch/.test(t)?`#ad8250`:/moss|grass|leaves|vine|cactus|azalea|lily|fern/.test(t)?`#527b4d`:/netherrack|nether_brick/.test(t)?`#63343b`:/snow/.test(t)?`#e6eff0`:/clay/.test(t)?`#9aa5b3`:Jt(t)}function Xt(e,t){let n=e.block,r=Wt(e,t),[i,a]=It[r.facing];if(n.endsWith(`_slab`))return r.slabType===`double`?[{size:[1,1,1],offset:[0,0,0]}]:[{size:[1,.5,1],offset:[0,r.slabType===`top`?.25:-.25,0]}];if(n.endsWith(`_stairs`)){let e=r.half===`top`;return[{size:[1,.5,1],offset:[0,e?.25:-.25,0]},{size:[Math.abs(i)?.5:1,.5,Math.abs(a)?.5:1],offset:[i*.25,e?-.25:.25,a*.25]}]}if(n.endsWith(`_trapdoor`))return r.open?[{size:[Math.abs(i)?.1875:1,1,Math.abs(a)?.1875:1],offset:[i*.40625,0,a*.40625]}]:[{size:[1,.1875,1],offset:[0,r.half===`top`?.40625:-.40625,0]}];if(/glass_pane|iron_bars/.test(n)){let t=t=>String(e.state?.[t]??``),n=[{size:[.125,1,.125],offset:[0,0,0]}];return t(`north`)===`true`&&n.push({size:[.125,1,.5],offset:[0,0,-.25]}),t(`south`)===`true`&&n.push({size:[.125,1,.5],offset:[0,0,.25]}),t(`west`)===`true`&&n.push({size:[.5,1,.125],offset:[-.25,0,0]}),t(`east`)===`true`&&n.push({size:[.5,1,.125],offset:[.25,0,0]}),n}if(/_fence$|_wall$/.test(n)){let t=t=>[`true`,`low`,`tall`].includes(String(e.state?.[t]??``)),n=[{size:[.25,1,.25],offset:[0,0,0]}];return t(`north`)&&n.push({size:[.25,.5,.5],offset:[0,.05,-.25]}),t(`south`)&&n.push({size:[.25,.5,.5],offset:[0,.05,.25]}),t(`west`)&&n.push({size:[.5,.5,.25],offset:[-.25,.05,0]}),t(`east`)&&n.push({size:[.5,.5,.25],offset:[.25,.05,0]}),n}if(/_door$/.test(n)&&!/_trapdoor$/.test(n)){let e=Lt[r.facing];if(!r.open)return[{size:[1,1,.1875],offset:[0,0,0],rotationY:e}];let t=r.hinge===`left`?-1:1,n=[-a,i];return[{size:[1,1,.1875],offset:[(n[0]*t+i)*.40625,0,(n[1]*t+a)*.40625],rotationY:e+(r.hinge===`left`?Math.PI/2:-Math.PI/2)}]}return/(^|:)lantern$|soul_lantern$/.test(n)?[{size:[.5,.5,.5],offset:[0,-.05,0],role:`lantern`},{size:[.25,.18,.25],offset:[0,.29,0],role:`metal`},...r.hanging?[{size:[.12,.28,.12],offset:[0,.43,0],role:`metal`}]:[]]:[{size:[1,1,1],offset:[0,0,0]}]}var Z=t(),Zt={change:`#e9ad4f`,fix:`#ef6b5b`,remove:`#c74f76`,liked:`#5ec6a7`};function Qt(){let e=`(max-width: 620px), (pointer: coarse)`,[t,n]=(0,G.useState)(()=>typeof window<`u`&&typeof window.matchMedia==`function`&&window.matchMedia(e).matches);return(0,G.useEffect)(()=>{if(typeof window>`u`||typeof window.matchMedia!=`function`)return;let t=window.matchMedia(e),r=()=>n(t.matches);return r(),t.addEventListener(`change`,r),()=>t.removeEventListener(`change`,r)},[]),t}var Q=({x:e,y:t,z:n})=>`${e},${t},${n}`,$t=e=>e.replace(`minecraft:`,``).split(`_`).map(e=>e[0].toUpperCase()+e.slice(1)).join(` `),en=e=>Object.entries(e??{}).sort(([e],[t])=>e.localeCompare(t)).map(([e,t])=>`${e}=${String(t)}`).join(`, `),tn=(e,t)=>!!(e&&t&&e.x===t.x&&e.y===t.y&&e.z===t.z),nn=e=>({x:(e.min.x+e.max.x)/2,y:(e.min.y+e.max.y)/2,z:(e.min.z+e.max.z)/2});function rn(e){let t=(0,G.useMemo)(()=>{let t=new Map;if(!e)return t;let n=new c;for(let r of e.textures.values())for(let e of Object.values(r)){if(t.has(e))continue;let r=n.load(e);r.colorSpace=g,r.magFilter=ee,r.minFilter=f,t.set(e,r)}return t},[e]);return(0,G.useEffect)(()=>()=>{for(let e of t.values())e.dispose()},[t]),t}function an({placements:e,part:t,block:n,textures:r,textureMaps:i,dimmed:a,onPick:o}){let s=(0,G.useRef)(null),c=ve(e=>e.invalidate),l=(0,G.useMemo)(()=>{let e=r?.top,o=e?i.get(e):void 0,s=t.role===`lantern`?new x(`#b86b22`):new x(`#000000`);return new v({color:e?`#ffffff`:t.role===`metal`?`#242a2c`:Yt(n),map:o,roughness:t.role===`metal`?.45:.88,metalness:t.role===`metal`?.5:0,transparent:a||/glass|pane|leaves/.test(n),opacity:a?.2:1,alphaTest:/glass|pane|leaves|door|trapdoor/.test(n)?.08:0,emissive:s,emissiveIntensity:t.role===`lantern`?1.1:0})},[n,a,t.role,i,r?.top]);return(0,G.useEffect)(()=>()=>{l.dispose()},[l]),(0,G.useLayoutEffect)(()=>{s.current&&Rt(s.current,e,t,c)},[c,e,t]),(0,Z.jsx)(`instancedMesh`,{ref:s,args:[void 0,void 0,e.length],material:l,frustumCulled:!0,onClick:t=>{t.stopPropagation(),t.instanceId!==void 0&&o(e[t.instanceId])},children:(0,Z.jsx)(`boxGeometry`,{args:[1,1,1]})})}function on({selection:e,color:t=`#f2b661`}){if(!e)return null;let n=[e.max.x-e.min.x+1.08,e.max.y-e.min.y+1.08,e.max.z-e.min.z+1.08],r=[(e.min.x+e.max.x)/2,(e.min.y+e.max.y)/2,(e.min.z+e.max.z)/2];return(0,Z.jsxs)(Ye,{args:n,position:r,children:[(0,Z.jsx)(`meshBasicMaterial`,{transparent:!0,opacity:.035,color:t,depthWrite:!1}),(0,Z.jsx)(K,{color:t})]})}function sn({build:e,maxLayer:t,hideRoof:n,cameraPreset:r,cameraTarget:i,cameraDistance:a,orthographic:o,selection:s,annotations:c,texturePack:l,mobileRendering:u,onPick:d}){let f=rn(l),p=(0,G.useMemo)(()=>{let r=new Map;for(let i of e.placements){if(i.y>t||n&&Et(i,e))continue;let a=Ae(i.block,i.state),o=r.get(a)??{placement:i,placements:[],parts:Xt(i,e.input.edition)};o.placements.push(i),r.set(a,o)}return[...r.entries()]},[e,n,t]),m=[(e.bounds.min.x+e.bounds.max.x)/2,(e.bounds.min.y+e.bounds.max.y)/2,(e.bounds.min.z+e.bounds.max.z)/2],h=i?[i.x,i.y,i.z]:m,g=Math.max(e.bounds.dimensions.width,e.bounds.dimensions.depth,e.bounds.dimensions.height)*1.35,_=Math.max(6,Math.min(g,a??g)),v=`${r}-${Q({x:h[0],y:h[1],z:h[2]})}-${_.toFixed(2)}`,y={iso:[h[0]+_,h[1]+_*.65,h[2]-_],top:[h[0],h[1]+_*1.6,h[2]+.01],north:[h[0],h[1]+_*.3,h[2]-_*1.3],south:[h[0],h[1]+_*.3,h[2]+_*1.3],east:[h[0]+_*1.3,h[1]+_*.3,h[2]],west:[h[0]-_*1.3,h[1]+_*.3,h[2]]};return(0,Z.jsxs)(ge,{frameloop:`demand`,shadows:!u,dpr:u?1:[1,1.5],gl:{antialias:!u,alpha:!1,powerPreference:u?`low-power`:`high-performance`},onPointerMissed:()=>void 0,children:[(0,Z.jsx)(`color`,{attach:`background`,args:[`#06141e`]}),o?(0,Z.jsx)(oe,{makeDefault:!0,position:y[r],zoom:Math.max(4,850/_),onUpdate:e=>e.lookAt(...h)},`review-ortho-${v}`):(0,Z.jsx)(D,{makeDefault:!0,position:y[r],fov:42,onUpdate:e=>e.lookAt(...h)},`review-perspective-${v}`),(0,Z.jsx)(`ambientLight`,{intensity:1.05,color:`#a8bfd0`}),(0,Z.jsx)(`directionalLight`,{position:[h[0]+_,h[1]+_,h[2]-_],intensity:2.2,color:`#f5e7cf`,castShadow:!u}),p.flatMap(([e,t])=>t.parts.map((n,r)=>(0,Z.jsx)(an,{placements:t.placements,part:n,block:t.placement.block,textures:l?.textures.get(e),textureMaps:f,dimmed:!1,onPick:d},`${e}-${r}`))),(0,Z.jsx)(on,{selection:s}),c.map(e=>(0,Z.jsx)(on,{selection:e.bounds,color:e.resolved?`#536b76`:Zt[e.category]},e.id)),(0,Z.jsx)(A,{position:[m[0],e.bounds.min.y-.51,m[2]],args:[Math.max(64,g*2),Math.max(64,g*2)],cellSize:1,cellColor:`#294554`,sectionSize:5,sectionColor:`#3f6170`,fadeDistance:g*1.8,infiniteGrid:!0}),(0,Z.jsx)(k,{makeDefault:!0,target:h,minDistance:2,maxDistance:g*4,maxPolarAngle:Math.PI/2.01,enabled:!0})]})}function cn(e,t){return{min:{x:Math.min(e.x,t.x),y:Math.min(e.y,t.y),z:Math.min(e.z,t.z)},max:{x:Math.max(e.x,t.x),y:Math.max(e.y,t.y),z:Math.max(e.z,t.z)}}}function $({label:e,shortcut:t,active:n,disabled:r,onClick:i,children:a}){let o=t?`${e} (${t})`:e;return(0,Z.jsx)(`button`,{type:`button`,className:`review-icon-button ${n?`active`:``}`,"aria-label":o,"aria-pressed":n===void 0?void 0:n,title:o,disabled:r,onClick:i,children:a})}function ln(e){return{reviewBuildId:e?.id,reviewBuildHash:e?.hash,mode:`orbit`,layer:e?.bounds.max.y??0,hideRoof:!1,orthographic:!1,cameraPreset:`iso`,cameraTarget:void 0,cameraDistance:void 0,annotations:[],selection:void 0,anchor:void 0,searchQuery:``,searchCursor:-1,auditQuery:``,auditSeverity:`all`,annotationQuery:``,annotationCategory:`all`,annotationStatus:`all`,focusedFindingCode:void 0,focusedFindingIndex:void 0}}function un(){let{output:e,isPending:t,responseMetadata:n}=i(),[r,o]=be(),{maxHeight:s}=Se(),{download:c}=Te(),l=De(),u=Qt(),d=n,[f,p]=(0,G.useState)(!1),[m,h]=(0,G.useState)(!1),g=At(f,r),_=me(d?.buildSummary,d?.buildPage,d?.build,{enabled:g}),v=g?_.build:void 0,y=d?.audit,ee=e?.review,b=(v??d?.buildSummary)?.bounds.max.y??0,x=(v??d?.buildSummary)?.bounds.min.y??0,[S,C]=xe(ln(v)),w=(v?St(S,v):`unbound`)===`current`?S:ln(v),T=w.mode??`orbit`,E=w.layer??b,ne=w.hideRoof??!1,oe=w.orthographic??!1,D=w.cameraPreset??`iso`,O=w.cameraTarget,ce=w.cameraDistance,k=Array.isArray(w.annotations)?w.annotations:[],A=w.selection,ge=w.anchor,j=w.searchQuery??``,_e=w.auditQuery??``,ve=w.auditSeverity??`all`,ye=w.annotationQuery??``,Ae=w.annotationCategory??`all`,Ne=w.annotationStatus??`all`,[Pe,Fe]=(0,G.useState)(`fix`),[M,N]=(0,G.useState)(``),[P,F]=(0,G.useState)(),[I,Ie]=(0,G.useState)(),[L,R]=(0,G.useState)(),[z,B]=(0,G.useState)(!1),[Le,Re]=(0,G.useState)(null),[V,ze]=(0,G.useState)(`Procedural fallback`),Be=(0,G.useRef)(null),Ve=(0,G.useRef)(null),H=(0,G.useRef)(null),U=(0,G.useRef)(globalThis.crypto?.randomUUID?.()??`${Date.now().toString(36)}_${Math.random().toString(36).slice(2,12)}`),W=v?`${v.id}:${v.hash}`:``,He=(0,G.useRef)(W);He.current=W;let Ue=(0,G.useMemo)(()=>{let e=new Map;for(let t of v?.placements??[])e.set(Q(t),t);return e},[v]),We=(0,G.useMemo)(()=>v?.placements.reduce((e,t)=>e+ +(t.y<=E&&(!ne||!Et(t,v))),0)??0,[v,ne,E]),Ge=(0,G.useMemo)(()=>!v||bt(j)?{matches:[],capped:!1,tooShort:!1}:xt(v.placements,j),[v,j]),Ke=Ge.matches,qe=(0,G.useMemo)(()=>{if(!y)return[];let e=_e.trim().toLowerCase();return y.findings.filter(t=>(ve===`all`||t.severity===ve)&&(!e||`${t.code.replaceAll(`_`,` `)} ${t.message} ${t.coordinates.map(Q).join(` `)}`.toLowerCase().includes(e)))},[y,_e,ve]),K=(0,G.useMemo)(()=>qe.flatMap(e=>e.coordinates.map((t,n)=>({finding:e,coordinate:t,coordinateIndex:n}))),[qe]),Je=(0,G.useMemo)(()=>{let e=ye.trim().toLowerCase();return k.filter(t=>(Ae===`all`||t.category===Ae)&&(Ne===`all`||Ne===`resolved`==!!t.resolved)&&(!e||`${t.category} ${t.note} ${t.pickedBlock??``} ${Q(t.bounds.min)} ${Q(t.bounds.max)}`.toLowerCase().includes(e)))},[Ae,ye,Ne,k]);(0,G.useEffect)(()=>{if(!v)return;let e=St(S,v);if(e===`different`){C(ln(v)),Fe(`fix`),N(``),F(void 0),Ie(void 0),B(!1),Re(null),ze(`Procedural fallback`),R({kind:`info`,message:`Build changed; previous build-bound review state was cleared.`});return}if(e===`unbound`){let e=[],t=Array.isArray(S.annotations)?S.annotations:[];try{e=Tt({schemaVersion:1,type:`blockwright-review`,build:{id:v.id,hash:v.hash},annotations:t},v)}catch{}C({...ln(v),annotations:e}),t.length&&!e.length&&R({kind:`info`,message:`Older saved annotations could not be verified for this build and were cleared.`});return}let t=Array.isArray(S.annotations)?S.annotations:[],n=t.length>500?t.slice(0,500):t,r=typeof S.layer==`number`&&S.layer>=v.bounds.min.y&&S.layer<=v.bounds.max.y?S.layer:v.bounds.max.y;(n!==S.annotations||r!==S.layer)&&(C(e=>({...e,layer:r,annotations:n})),t.length>500&&R({kind:`info`,message:`Saved review state was repaired to the 500-annotation limit.`}))},[v?.hash,v?.id,S.annotations?.length,S.reviewBuildHash,S.reviewBuildId]),(0,G.useEffect)(()=>()=>Le?.dispose(),[Le]);let Ye=()=>{p(!1),h(!1),B(!1),Re(null),ze(`Procedural fallback`)},ft=async()=>{if(!m){h(!0),p(!0),R(void 0);try{if((await o(`fullscreen`)).mode!==`fullscreen`){p(!1),R({kind:`error`,message:`This host did not open a fullscreen review. The low-resource summary remains active.`});return}}catch(e){p(!1),R({kind:`error`,message:e instanceof Error?e.message:`The 3D reviewer could not be opened.`})}finally{h(!1)}}},pt=()=>{Ye(),o(`inline`).catch(e=>R({kind:`error`,message:e instanceof Error?e.message:`The viewer was stopped, but the host could not collapse this card.`}))},q=()=>{Ye(),o(`inline`).catch(()=>void 0),l().catch(e=>R({kind:`error`,message:e instanceof Error?`3D stopped. ${e.message}`:`3D stopped, but the host could not close this card.`}))};(0,G.useEffect)(()=>{!m&&f&&r!==`fullscreen`&&Ye()},[r,f,m]),(0,G.useEffect)(()=>{if(!g||typeof window>`u`)return;let e=U.current,t=!1,n=()=>{t||(t=!0,Ye(),R({kind:`info`,message:`3D stopped because another Blockwright reviewer became active. Only one live 3D viewer is kept at a time.`}),o(`inline`).catch(()=>void 0))},r=t=>{Mt(t,e)&&n()},i;try{i=new BroadcastChannel(Dt),i.addEventListener(`message`,e=>r(e.data))}catch{}let a=e=>{if(e.key===`blockwright:reviewer:3d-lease:v1`&&e.newValue)try{r(JSON.parse(e.newValue))}catch{}};window.addEventListener(`storage`,a);let s=jt(e);try{i?.postMessage(s)}catch{}try{window.localStorage.setItem(Ot,JSON.stringify(s))}catch{}return()=>{i?.close(),window.removeEventListener(`storage`,a)}},[g]),(0,G.useEffect)(()=>{if(!g)return;let e=e=>{let t=e.target?.matches(`input, textarea, select, [contenteditable='true']`);if(e.key===`Escape`){z?B(!1):(F(void 0),N(``),C(e=>({...e,anchor:void 0,selection:void 0})));return}if(t)return;let n=e.key.toLowerCase(),r={o:`orbit`,b:`select`,r:`region`,m:`measure`},i={1:`iso`,2:`top`,3:`north`,4:`south`,5:`east`,6:`west`};r[n]?(e.preventDefault(),C(e=>({...e,mode:r[n],anchor:void 0}))):i[n]?(e.preventDefault(),C(e=>({...e,cameraPreset:i[n]}))):n===`0`?(e.preventDefault(),C(e=>({...e,cameraTarget:void 0,cameraDistance:void 0}))):n===`p`?(e.preventDefault(),C(e=>({...e,orthographic:!e.orthographic}))):n===`h`?(e.preventDefault(),C(e=>({...e,hideRoof:!e.hideRoof}))):e.key===`[`?(e.preventDefault(),C(e=>({...e,layer:Math.max(x,(e.layer??b)-1)}))):e.key===`]`?(e.preventDefault(),C(e=>({...e,layer:Math.min(b,(e.layer??b)+1)}))):e.key===`?`||e.key===`/`&&e.shiftKey?(e.preventDefault(),B(e=>!e)):e.key===`/`&&(e.preventDefault(),H.current?.focus())};return window.addEventListener(`keydown`,e),()=>window.removeEventListener(`keydown`,e)},[b,x,g,z]);let J=d?.buildSummary,mt=ee?.name??J?.input.name??`Build review`,ht=ee?.blockCount??J?.blockCount,gt=ee?.audit??y?.totals,Y=Nt(J?.materialCounts??{}),Ct=J?.bounds.dimensions,kt=J?`Review summary for ${mt}, immutable hash ${J.hash.slice(0,12)}. ${ht?.toLocaleString()??`Unknown`} blocks, ${Y.materialCount} exact materials. ${gt?`${gt.errors} audit errors and ${gt.warnings} warnings.`:`Audit pending.`} 3D is not loaded until explicitly opened.`:`Preparing a low-resource Blockwright review summary. 3D is not loaded.`;if(!g)return(0,Z.jsx)(a,{content:kt,children:(0,Z.jsxs)(`section`,{className:`inline-summary review-inline review-inline-summary`,style:{maxHeight:s||void 0},"aria-busy":t,children:[(0,Z.jsx)(`div`,{className:`brand-cube`,children:(0,Z.jsx)(pe,{size:22})}),(0,Z.jsxs)(`div`,{className:`review-inline-copy`,children:[(0,Z.jsxs)(`h2`,{children:[`Review `,mt]}),(0,Z.jsxs)(`p`,{children:[ht===void 0?`Preparing audited build summary…`:`${ht.toLocaleString()} exact blocks`,J?` · ${J.input.edition} ${J.input.version}${Ct?` · ${Ct.width}×${Ct.depth}×${Ct.height}`:``}`:``]}),gt&&(0,Z.jsxs)(`div`,{className:`review-inline-facts`,"aria-label":`Audit summary`,children:[(0,Z.jsxs)(`span`,{children:[gt.errors,` errors`]}),(0,Z.jsxs)(`span`,{children:[gt.warnings,` warnings`]}),(0,Z.jsxs)(`span`,{children:[Y.materialCount,` materials`]})]}),Y.visible.length>0&&(0,Z.jsxs)(`p`,{className:`review-inline-palette`,children:[(0,Z.jsx)(`strong`,{children:`Top materials:`}),` `,Y.visible.map(([e,t])=>`${$t(e)} (${t.toLocaleString()})`).join(`, `),Y.hiddenCount>0?`, +${Y.hiddenCount} more`:``]}),L&&(0,Z.jsx)(`p`,{className:`review-inline-notice ${L.kind}`,role:L.kind===`error`?`alert`:`status`,children:L.message})]}),(0,Z.jsxs)(`div`,{className:`review-inline-actions`,children:[(0,Z.jsxs)(`button`,{className:`primary-button`,disabled:m||t||!J||!ee||!y,onClick:()=>void ft(),children:[(0,Z.jsx)(Ce,{size:16}),m?`Opening…`:`Open 3D`]}),(0,Z.jsxs)(`button`,{type:`button`,className:`review-close-button`,onClick:q,"aria-label":`Close viewer`,children:[(0,Z.jsx)(Ee,{size:16}),(0,Z.jsx)(`span`,{children:`Close`})]})]})]})});if(!t&&d?.buildSummary&&_.error)return(0,Z.jsxs)(`section`,{className:`inline-summary review-inline-summary`,style:{maxHeight:s||void 0},role:`alert`,children:[(0,Z.jsx)(ue,{size:34}),(0,Z.jsxs)(`div`,{className:`review-inline-copy`,children:[(0,Z.jsx)(`h2`,{children:`Exact review blocks could not be loaded`}),(0,Z.jsx)(`p`,{children:_.error})]}),(0,Z.jsxs)(`div`,{className:`review-inline-actions`,children:[(0,Z.jsx)(`button`,{type:`button`,onClick:pt,children:`Back to summary`}),(0,Z.jsxs)(`button`,{type:`button`,className:`review-close-button`,onClick:q,"aria-label":`Close viewer`,children:[(0,Z.jsx)(Ee,{size:16}),(0,Z.jsx)(`span`,{children:`Close`})]})]})]});if(t||!v||!ee||!y)return(0,Z.jsxs)(`section`,{className:`inline-summary review-inline-summary`,style:{maxHeight:s||void 0},"aria-busy":`true`,children:[(0,Z.jsx)(ae,{size:34}),(0,Z.jsxs)(`div`,{className:`review-inline-copy`,children:[(0,Z.jsx)(`h2`,{children:`Loading exact review blocks`}),(0,Z.jsx)(`p`,{children:d?.buildSummary?`${_.loaded.toLocaleString()} / ${_.total.toLocaleString()}`:`Preparing exact 3D review…`})]}),(0,Z.jsxs)(`div`,{className:`review-inline-actions`,children:[(0,Z.jsx)(`button`,{type:`button`,onClick:pt,children:`Cancel 3D`}),(0,Z.jsxs)(`button`,{type:`button`,className:`review-close-button`,onClick:q,"aria-label":`Close viewer`,children:[(0,Z.jsx)(Ee,{size:16}),(0,Z.jsx)(`span`,{children:`Close`})]})]})]});let Pt=e=>{let t={x:e.x,y:e.y,z:e.z};return{...cn(t,t),type:`block`,blockCount:1,pickedBlock:e.block,pickedState:e.state,pickedPhase:e.phase}},Ft=e=>{let t=vt(e,0);C(n=>({...n,cameraTarget:nn(e),cameraDistance:Math.max(6,Math.max(t.width,t.height,t.depth)*2.1),layer:Math.max(x,Math.min(b,e.max.y))}))},It=(e,t)=>{let n={x:e.x,y:e.y,z:e.z};C(r=>({...r,mode:`select`,selection:Pt(e),anchor:void 0,layer:n.y,hideRoof:!Et(e,v)&&r.hideRoof,cameraTarget:n,cameraDistance:8,focusedFindingCode:t?.code,focusedFindingIndex:t?.coordinateIndex}))},Lt=e=>{let t=Ue.get(Q(e.coordinate));if(!t){R({kind:`error`,message:`Audit coordinate ${Q(e.coordinate)} is not present in the immutable build.`});return}It(t,{code:e.finding.code,coordinateIndex:e.coordinateIndex}),R({kind:`info`,message:`${e.finding.code.replaceAll(`_`,` `)} · sample ${e.coordinateIndex+1} of ${e.finding.coordinates.length}`})},Rt=e=>{if(!K.length)return;let t=K.findIndex(e=>e.finding.code===w.focusedFindingCode&&e.coordinateIndex===w.focusedFindingIndex),n=t<0?e>0?0:K.length-1:(t+e+K.length)%K.length;Lt(K[n])},zt=e=>{let t={x:e.x,y:e.y,z:e.z};if(T===`orbit`)return;if(T===`select`){C(t=>({...t,selection:Pt(e),anchor:void 0}));return}if(!ge){C(e=>({...e,anchor:t,selection:void 0}));return}let n=cn(ge,t);C(t=>({...t,anchor:void 0,selection:{...n,type:T===`measure`?`measure`:`region`,blockCount:_t(v,n),pickedBlock:e.block,pickedState:e.state,pickedPhase:e.phase}}))},Bt=()=>{let e=M.trim();if(!A||A.type===`measure`||!e)return;if(!P&&k.length>=500){R({kind:`error`,message:`This review already has the maximum 500 annotations. Resolve, edit, or remove an existing note before adding another.`});return}let t=new Date().toISOString();if(P){if(!k.some(e=>e.id===P)){F(void 0),R({kind:`error`,message:`That annotation is no longer present; no changes were saved.`});return}C(n=>({...n,annotations:n.annotations.map(n=>n.id===P?{...n,category:Pe,note:e,bounds:{min:A.min,max:A.max},blockCount:A.blockCount,pickedBlock:A.pickedBlock,pickedState:A.pickedState,updatedAt:t}:n),selection:void 0})),R({kind:`success`,message:`Annotation updated.`}),F(void 0),N(``);return}let n=globalThis.crypto?.randomUUID?.()??`${Date.now().toString(36)}_${Math.random().toString(36).slice(2,12)}`,r={category:Pe,note:e,bounds:{min:A.min,max:A.max},blockCount:A.blockCount,pickedBlock:A.pickedBlock,pickedState:A.pickedState,createdAt:t};C(e=>{let t=wt(Array.isArray(e.annotations)?e.annotations:[],r,n);return t?{...e,annotations:t,selection:void 0}:e}),N(``),R({kind:`success`,message:`Annotation saved to exact coordinates.`})},X=e=>{Fe(e.category),N(e.note),F(e.id);let t=v.placements.find(t=>t.x>=e.bounds.min.x&&t.x<=e.bounds.max.x&&t.y>=e.bounds.min.y&&t.y<=e.bounds.max.y&&t.z>=e.bounds.min.z&&t.z<=e.bounds.max.z&&(!e.pickedBlock||t.block===e.pickedBlock));C(n=>({...n,selection:{...e.bounds,type:e.bounds.min.x===e.bounds.max.x&&e.bounds.min.y===e.bounds.max.y&&e.bounds.min.z===e.bounds.max.z?`block`:`region`,blockCount:e.blockCount,pickedBlock:e.pickedBlock,pickedState:e.pickedState,pickedPhase:t?.phase},anchor:void 0})),Ft(e.bounds),R({kind:`info`,message:`Editing annotation; save to apply changes.`})},Vt=e=>{let t=k.findIndex(t=>t.id===e.id);Ie({annotation:e,index:Math.max(0,t)}),C(t=>({...t,annotations:t.annotations.filter(t=>t.id!==e.id)})),P===e.id&&(F(void 0),N(``)),R({kind:`info`,message:`Annotation removed. Undo is available.`})},Ht=()=>{I&&(C(e=>{if(e.annotations.some(e=>e.id===I.annotation.id)||e.annotations.length>=500)return e;let t=[...e.annotations];return t.splice(Math.min(I.index,t.length),0,I.annotation),{...e,annotations:t}}),Ie(void 0),R({kind:`success`,message:`Annotation restored.`}))},Ut=e=>{let t=!e.resolved;C(n=>({...n,annotations:n.annotations.map(n=>n.id===e.id?{...n,resolved:t,updatedAt:new Date().toISOString()}:n)})),R({kind:`success`,message:t?`Annotation marked resolved.`:`Annotation reopened.`})},Wt=async()=>{let e=W,t=v.input.name.toLowerCase().replace(/[^a-z0-9]+/g,`-`).replace(/^-|-$/g,``)||`blockwright-build`,n={schemaVersion:1,type:`blockwright-review`,build:{id:v.id,hash:v.hash,name:v.input.name,edition:v.input.edition,version:v.input.version,bounds:v.bounds},annotations:k,audit:y,viewer:{mode:T,layer:E,hideRoof:ne,orthographic:oe,cameraPreset:D,cameraTarget:O,cameraDistance:ce},exportedAt:new Date().toISOString()};try{Tt(n,v);let r=JSON.stringify(n,null,2);if(new TextEncoder().encode(r).byteLength>1e6)throw Error(`This review exceeds the ${Math.round(ut/1e3)} KB import limit. Shorten or remove annotations before exporting.`);if(He.current!==e)throw Error(`The build changed before export completed. Export the newly opened review instead.`);let i=await c({contents:[{type:`resource`,resource:{uri:`file:///${t}-review.json`,mimeType:`application/json`,text:r}}]});if(He.current!==e)return;R(i.isError?{kind:`info`,message:`Review export was canceled or unavailable.`}:{kind:`success`,message:`Exported ${k.length} annotations for build ${v.hash.slice(0,12)}.`})}catch(e){R({kind:`error`,message:e instanceof Error?e.message:`Could not export this review.`})}},Gt=async e=>{if(!e)return;let t=W;try{if(e.size>1e6)throw Error(`Review files must be ${Math.round(ut/1e3)} KB or smaller.`);if(!e.name.toLowerCase().endsWith(`.json`))throw Error(`Choose a Blockwright review JSON file.`);let n=await e.text();if(He.current!==t)throw Error(`The build changed while the review file was being read. Choose the file again for the current build.`);let r=Tt(JSON.parse(n),v);C(e=>St(e,v)===`current`?{...e,annotations:r}:e),F(void 0),Ie(void 0),N(``),R({kind:`success`,message:`Imported ${r.length} validated annotation${r.length===1?``:`s`}; build hash matched.`})}catch(e){R({kind:`error`,message:e instanceof Error?e.message:`Could not import this review.`})}},Kt=async e=>{if(!e)return;let t=W;ze(`Reading ${e.name}…`);try{let n=await Me(e,v.placements);if(He.current!==t){n.dispose();return}Re(e=>(e?.dispose(),n)),ze(`${n.name} · ${n.resolved}/${n.requested} states resolved`),R({kind:`success`,message:`${n.resolved} of ${n.requested} material states resolved from ${n.name}.`})}catch(e){ze(e instanceof Error?e.message:`Could not read this resource pack.`),R({kind:`error`,message:e instanceof Error?e.message:`Could not read this resource pack.`})}},qt=()=>{let e=bt(j);if(e){let t=Ue.get(Q(e));if(!t){R({kind:`error`,message:`No canonical block exists at ${Q(e)}.`});return}It(t),R({kind:`success`,message:`Focused ${t.block} at ${Q(t)}.`});return}if(!Ke.length){let e=j.trim();R({kind:`error`,message:Ge.tooShort?`Use at least 2 characters for block, phase, or state search; exact coordinates are always accepted.`:e?`No block, phase, or state matches “${e}”.`:`Enter coordinates, a block, phase, or state.`});return}let t=((w.searchCursor??-1)+1)%Ke.length,n=Ke[t];It(n),C(e=>({...e,searchCursor:t})),R({kind:`success`,message:`Match ${t+1} of ${Ke.length}${Ge.capped?`+ capped results`:``}: ${n.block} at ${Q(n)}.`})},Jt=async(e,t)=>{try{if(!navigator.clipboard?.writeText)throw Error(`Clipboard access is unavailable in this host.`);await navigator.clipboard.writeText(e),R({kind:`success`,message:`${t} copied.`})}catch(e){R({kind:`error`,message:e instanceof Error?e.message:`Could not copy to the clipboard.`})}},Yt=A?vt(A,A.blockCount):void 0,Xt=A?.type===`measure`?yt(A):void 0,rn=A?.pickedState?en(A.pickedState):``,an=Math.max(x,Math.min(E,b)),on=k.filter(e=>!e.resolved).length,un=y.findings.find(e=>e.code===w.focusedFindingCode),dn=`Reviewing ${v.input.name}, immutable hash ${v.hash.slice(0,12)}. ${We} of ${v.placements.length} blocks visible through Y ${an}; ${ne?`roof hidden`:`roof visible`}. Camera ${D} ${oe?`orthographic`:`perspective`}${O?` focused at ${Q(O)}`:` framed on the full build`}. ${k.length} annotations: ${on} open and ${k.length-on} resolved. ${A?`Selected ${A.type} from ${Q(A.min)} to ${Q(A.max)}${A.pickedBlock?`; canonical block ${A.pickedBlock}${rn?` with state ${rn}`:``}`:``}.`:`No selection.`} ${un?`Current audit finding ${un.code}, sample ${(w.focusedFindingIndex??0)+1}.`:``} Global audit: ${y.totals.errors} errors and ${y.totals.warnings} warnings across ${y.scannedPlacements} placements.`;return(0,Z.jsx)(a,{content:dn,children:(0,Z.jsxs)(`main`,{className:`review-shell`,style:{maxHeight:s||void 0},children:[(0,Z.jsxs)(`header`,{className:`review-header`,children:[(0,Z.jsxs)(`div`,{children:[(0,Z.jsx)(`span`,{className:`panel-kicker`,children:`Blockwright reviewer`}),(0,Z.jsx)(`h1`,{children:v.input.name})]}),(0,Z.jsxs)(`div`,{className:`review-header-actions`,children:[(0,Z.jsxs)(`button`,{onClick:()=>Ve.current?.click(),children:[(0,Z.jsx)(je,{size:15}),`Textures`]}),(0,Z.jsxs)(`button`,{onClick:()=>Be.current?.click(),children:[(0,Z.jsx)(et,{size:15}),`Import review`]}),(0,Z.jsxs)(`button`,{className:`primary-button`,onClick:()=>void Wt(),children:[(0,Z.jsx)(we,{size:15}),`Export review`]}),(0,Z.jsx)($,{label:`Collapse reviewer`,onClick:pt,children:(0,Z.jsx)(Ce,{size:16})}),(0,Z.jsxs)(`button`,{type:`button`,className:`review-close-button`,onClick:q,"aria-label":`Close viewer`,children:[(0,Z.jsx)(Ee,{size:16}),(0,Z.jsx)(`span`,{children:`Close`})]})]}),(0,Z.jsx)(`input`,{ref:Ve,hidden:!0,type:`file`,accept:`.zip,.jar,application/zip,application/java-archive`,onChange:e=>void Kt(e.target.files?.[0])}),(0,Z.jsx)(`input`,{ref:Be,hidden:!0,type:`file`,accept:`.json,application/json`,onChange:e=>{let t=e.currentTarget.files?.[0];e.currentTarget.value=``,Gt(t)}})]}),(0,Z.jsxs)(`aside`,{className:`review-tools`,"aria-label":`Review tools`,children:[(0,Z.jsx)($,{label:`Orbit`,shortcut:`O`,active:T===`orbit`,onClick:()=>C(e=>({...e,mode:`orbit`,anchor:void 0})),children:(0,Z.jsx)(rt,{size:19})}),(0,Z.jsx)($,{label:`Select block`,shortcut:`B`,active:T===`select`,onClick:()=>C(e=>({...e,mode:`select`,anchor:void 0})),children:(0,Z.jsx)(te,{size:19})}),(0,Z.jsx)($,{label:`Select region`,shortcut:`R`,active:T===`region`,onClick:()=>C(e=>({...e,mode:`region`,anchor:void 0})),children:(0,Z.jsx)(fe,{size:19})}),(0,Z.jsx)($,{label:`Measure`,shortcut:`M`,active:T===`measure`,onClick:()=>C(e=>({...e,mode:`measure`,anchor:void 0})),children:(0,Z.jsx)(se,{size:19})}),(0,Z.jsx)($,{label:`Frame whole build`,shortcut:`0`,active:!O,onClick:()=>C(e=>({...e,cameraTarget:void 0,cameraDistance:void 0})),children:(0,Z.jsx)(tt,{size:19})}),(0,Z.jsx)(`span`,{className:`review-tools-spacer`}),(0,Z.jsx)($,{label:`Isometric view`,shortcut:`1`,active:D===`iso`,onClick:()=>C(e=>({...e,cameraPreset:`iso`})),children:(0,Z.jsx)($e,{size:19})}),(0,Z.jsx)($,{label:`Top view`,shortcut:`2`,active:D===`top`,onClick:()=>C(e=>({...e,cameraPreset:`top`})),children:(0,Z.jsx)(re,{size:19})}),(0,Z.jsx)($,{label:`North view`,shortcut:`3`,active:D===`north`,onClick:()=>C(e=>({...e,cameraPreset:`north`})),children:(0,Z.jsx)(ie,{size:19})}),(0,Z.jsx)($,{label:`South view`,shortcut:`4`,active:D===`south`,onClick:()=>C(e=>({...e,cameraPreset:`south`})),children:(0,Z.jsx)(re,{size:19})}),(0,Z.jsx)($,{label:`East view`,shortcut:`5`,active:D===`east`,onClick:()=>C(e=>({...e,cameraPreset:`east`})),children:(0,Z.jsx)(le,{size:19})}),(0,Z.jsx)($,{label:`West view`,shortcut:`6`,active:D===`west`,onClick:()=>C(e=>({...e,cameraPreset:`west`})),children:(0,Z.jsx)(he,{size:19})}),(0,Z.jsx)($,{label:`Keyboard shortcuts`,shortcut:`?`,active:z,onClick:()=>B(e=>!e),children:(0,Z.jsx)(Xe,{size:19})})]}),(0,Z.jsxs)(`section`,{className:`review-viewport`,children:[(0,Z.jsx)(sn,{build:v,maxLayer:an,hideRoof:ne,cameraPreset:D,cameraTarget:O,cameraDistance:ce,orthographic:oe,selection:A,annotations:k,texturePack:Le,mobileRendering:u,onPick:zt}),(0,Z.jsxs)(`form`,{className:`review-search`,role:`search`,onSubmit:e=>{e.preventDefault(),qt()},children:[(0,Z.jsx)(ot,{size:14,"aria-hidden":`true`}),(0,Z.jsx)(`input`,{ref:H,"aria-label":`Find exact coordinates, block, phase, or state`,value:j,onChange:e=>C(t=>({...t,searchQuery:e.target.value,searchCursor:-1})),placeholder:`x,y,z or block / phase / state`}),j&&(0,Z.jsx)(`button`,{type:`button`,"aria-label":`Clear search`,onClick:()=>C(e=>({...e,searchQuery:``,searchCursor:-1})),children:(0,Z.jsx)(Ee,{size:13})}),(0,Z.jsxs)(`button`,{type:`submit`,children:[`Find`,Ke.length?` · ${Ke.length}${Ge.capped?`+`:``}`:``]})]}),(0,Z.jsxs)(`div`,{className:`review-view-switch`,"aria-label":`Camera projection`,children:[(0,Z.jsx)(`button`,{type:`button`,"aria-pressed":!oe,className:oe?``:`active`,onClick:()=>C(e=>({...e,orthographic:!1})),children:`Perspective`}),(0,Z.jsx)(`button`,{type:`button`,"aria-pressed":oe,className:oe?`active`:``,onClick:()=>C(e=>({...e,orthographic:!0})),children:`Orthographic`})]}),(0,Z.jsxs)(`div`,{className:`review-viewport-status`,children:[(0,Z.jsxs)(`span`,{children:[We.toLocaleString(),` / `,v.placements.length.toLocaleString(),` visible`]}),O&&(0,Z.jsxs)(`span`,{children:[`Focus `,Q(O)]})]}),(0,Z.jsxs)(`div`,{className:`review-layer-control`,children:[(0,Z.jsx)(de,{size:15}),(0,Z.jsx)(`input`,{"aria-label":`Maximum visible Y layer ${an}`,type:`range`,min:x,max:b,value:an,onChange:e=>C(t=>({...t,layer:Number(e.target.value)}))}),(0,Z.jsxs)(`strong`,{children:[`Y ≤ `,an]}),(0,Z.jsxs)(`label`,{children:[(0,Z.jsx)(`input`,{type:`checkbox`,checked:ne,onChange:e=>C(t=>({...t,hideRoof:e.target.checked}))}),`Hide roof `,(0,Z.jsx)(`kbd`,{children:`H`})]})]}),ge&&(0,Z.jsxs)(`div`,{className:`review-instruction`,role:`status`,children:[`First corner: `,Q(ge),` · choose the second point `,(0,Z.jsx)(`button`,{type:`button`,onClick:()=>C(e=>({...e,anchor:void 0})),children:`Cancel`})]}),L&&(0,Z.jsxs)(`div`,{className:`review-activity ${L.kind}`,role:L.kind===`error`?`alert`:`status`,"aria-live":`polite`,children:[L.kind===`error`?(0,Z.jsx)(ue,{size:14}):L.kind===`success`?(0,Z.jsx)(Oe,{size:14}):(0,Z.jsx)(pe,{size:14}),(0,Z.jsx)(`span`,{children:L.message}),(0,Z.jsx)(`button`,{type:`button`,"aria-label":`Dismiss message`,onClick:()=>R(void 0),children:(0,Z.jsx)(Ee,{size:13})})]}),z&&(0,Z.jsxs)(`section`,{className:`review-shortcuts`,"aria-label":`Keyboard shortcuts`,children:[(0,Z.jsxs)(`header`,{children:[(0,Z.jsx)(`strong`,{children:`Keyboard shortcuts`}),(0,Z.jsx)(`button`,{type:`button`,"aria-label":`Close keyboard shortcuts`,onClick:()=>B(!1),children:(0,Z.jsx)(Ee,{size:14})})]}),(0,Z.jsxs)(`dl`,{children:[(0,Z.jsxs)(`div`,{children:[(0,Z.jsxs)(`dt`,{children:[(0,Z.jsx)(`kbd`,{children:`O`}),` `,(0,Z.jsx)(`kbd`,{children:`B`}),` `,(0,Z.jsx)(`kbd`,{children:`R`}),` `,(0,Z.jsx)(`kbd`,{children:`M`})]}),(0,Z.jsx)(`dd`,{children:`Orbit, block, region, measure`})]}),(0,Z.jsxs)(`div`,{children:[(0,Z.jsxs)(`dt`,{children:[(0,Z.jsx)(`kbd`,{children:`1`}),`–`,(0,Z.jsx)(`kbd`,{children:`6`})]}),(0,Z.jsx)(`dd`,{children:`Isometric, top, cardinal views`})]}),(0,Z.jsxs)(`div`,{children:[(0,Z.jsx)(`dt`,{children:(0,Z.jsx)(`kbd`,{children:`0`})}),(0,Z.jsx)(`dd`,{children:`Frame the whole build`})]}),(0,Z.jsxs)(`div`,{children:[(0,Z.jsxs)(`dt`,{children:[(0,Z.jsx)(`kbd`,{children:`P`}),` `,(0,Z.jsx)(`kbd`,{children:`H`})]}),(0,Z.jsx)(`dd`,{children:`Projection and roof visibility`})]}),(0,Z.jsxs)(`div`,{children:[(0,Z.jsxs)(`dt`,{children:[(0,Z.jsx)(`kbd`,{children:`[`}),` `,(0,Z.jsx)(`kbd`,{children:`]`})]}),(0,Z.jsx)(`dd`,{children:`Move the visible Y layer`})]}),(0,Z.jsxs)(`div`,{children:[(0,Z.jsxs)(`dt`,{children:[(0,Z.jsx)(`kbd`,{children:`/`}),` `,(0,Z.jsx)(`kbd`,{children:`?`})]}),(0,Z.jsx)(`dd`,{children:`Search and shortcut help`})]}),(0,Z.jsxs)(`div`,{children:[(0,Z.jsx)(`dt`,{children:(0,Z.jsx)(`kbd`,{children:`Esc`})}),(0,Z.jsx)(`dd`,{children:`Cancel anchor or clear selection`})]}),(0,Z.jsxs)(`div`,{children:[(0,Z.jsxs)(`dt`,{children:[(0,Z.jsx)(`kbd`,{children:`Ctrl`}),`+`,(0,Z.jsx)(`kbd`,{children:`Enter`})]}),(0,Z.jsx)(`dd`,{children:`Save the annotation draft`})]})]})]})]}),(0,Z.jsxs)(`aside`,{className:`review-inspector`,"aria-label":`Build review inspector`,children:[(0,Z.jsxs)(`section`,{children:[(0,Z.jsxs)(`div`,{className:`review-section-heading`,children:[(0,Z.jsx)(`span`,{className:`panel-kicker`,children:P?`Edit annotation`:`New annotation`}),P?(0,Z.jsx)(`button`,{type:`button`,className:`review-text-button`,onClick:()=>{F(void 0),N(``)},children:`Cancel edit`}):(0,Z.jsx)(`small`,{children:`exact world coordinates`})]}),(0,Z.jsx)(`div`,{className:`review-category-row`,children:lt.map(e=>(0,Z.jsx)(`button`,{type:`button`,"aria-pressed":Pe===e,className:Pe===e?`active`:``,style:{"--category":Zt[e]},onClick:()=>Fe(e),children:e},e))}),(0,Z.jsxs)(`label`,{className:`review-field-label`,htmlFor:`review-annotation-note`,children:[`Actionable intent `,(0,Z.jsxs)(`span`,{children:[M.length,`/`,dt]})]}),(0,Z.jsx)(`textarea`,{id:`review-annotation-note`,maxLength:dt,value:M,onChange:e=>N(e.target.value),onKeyDown:e=>{e.key===`Enter`&&(e.ctrlKey||e.metaKey)&&(e.preventDefault(),Bt())},placeholder:`Describe the issue, intended rule, or detail to preserve…`}),(0,Z.jsxs)(`button`,{type:`button`,className:`primary-button review-save`,disabled:!A||A.type===`measure`||!M.trim()||!P&&k.length>=500,onClick:Bt,children:[(0,Z.jsx)(ke,{size:15}),P?`Update annotation`:`Save annotation`]}),!P&&k.length>=500&&(0,Z.jsxs)(`small`,{className:`review-help-text`,children:[`Annotation limit reached (`,500,`/`,500,`). Existing notes can still be edited or resolved.`]}),!A&&(0,Z.jsx)(`small`,{className:`review-help-text`,children:`Select a block or region first. Measurements stay separate from annotations.`})]}),(0,Z.jsxs)(`section`,{children:[(0,Z.jsxs)(`div`,{className:`review-section-heading`,children:[(0,Z.jsx)(`span`,{className:`panel-kicker`,children:`Selection`}),(0,Z.jsx)(`small`,{children:A?.type??`none`})]}),A?(0,Z.jsxs)(`div`,{className:`review-selection-card`,children:[(0,Z.jsxs)(`div`,{className:`review-selection-title`,children:[(0,Z.jsxs)(`strong`,{children:[A.blockCount.toLocaleString(),` occupied block`,A.blockCount===1?``:`s`]}),(0,Z.jsx)(`button`,{type:`button`,title:`Frame selection`,"aria-label":`Frame selection`,onClick:()=>Ft(A),children:(0,Z.jsx)(nt,{size:14})})]}),(0,Z.jsxs)(`span`,{children:[`Min `,(0,Z.jsx)(`code`,{children:Q(A.min)})]}),(0,Z.jsxs)(`span`,{children:[`Max `,(0,Z.jsx)(`code`,{children:Q(A.max)})]}),Yt&&(0,Z.jsxs)(`span`,{children:[`Inclusive size `,(0,Z.jsxs)(`b`,{children:[Yt.width,` × `,Yt.height,` × `,Yt.depth]}),` · volume `,Yt.volume.toLocaleString()]}),Yt&&A.type!==`block`&&(0,Z.jsxs)(`span`,{children:[`Occupancy `,(Yt.density*100).toFixed(1),`%`]}),A.pickedBlock&&(0,Z.jsxs)(`span`,{className:`review-canonical`,children:[(0,Z.jsx)(`b`,{children:$t(A.pickedBlock)}),(0,Z.jsx)(`code`,{children:A.pickedBlock})]}),A.pickedPhase&&(0,Z.jsxs)(`span`,{children:[`Phase `,(0,Z.jsx)(`b`,{children:A.pickedPhase})]}),rn&&(0,Z.jsx)(`code`,{children:rn}),Xt&&(0,Z.jsxs)(`div`,{className:`review-measurements`,children:[(0,Z.jsxs)(`span`,{children:[`Axis Δ `,(0,Z.jsxs)(`b`,{children:[Xt.dx,`, `,Xt.dy,`, `,Xt.dz]})]}),(0,Z.jsxs)(`span`,{children:[`Horizontal `,(0,Z.jsx)(`b`,{children:Xt.horizontal.toFixed(2)})]}),(0,Z.jsxs)(`span`,{children:[`Direct center-to-center `,(0,Z.jsx)(`b`,{children:Xt.direct.toFixed(2)})]}),(0,Z.jsxs)(`span`,{children:[`Manhattan `,(0,Z.jsx)(`b`,{children:Xt.manhattan})]})]}),(0,Z.jsxs)(`div`,{className:`review-copy-row`,children:[(0,Z.jsxs)(`button`,{type:`button`,onClick:()=>void Jt(Q(A.min),`Minimum coordinates`),children:[(0,Z.jsx)(Qe,{size:12}),`Copy min`]}),(0,Z.jsxs)(`button`,{type:`button`,onClick:()=>void Jt(`/tp @s ${A.min.x} ${A.min.y} ${A.min.z}`,`Teleport command`),children:[(0,Z.jsx)(Qe,{size:12}),`Copy /tp`]})]})]}):(0,Z.jsx)(`p`,{className:`review-empty`,children:`Choose block or region select, then click the model.`})]}),(0,Z.jsxs)(`section`,{children:[(0,Z.jsxs)(`div`,{className:`review-section-heading`,children:[(0,Z.jsx)(`span`,{className:`panel-kicker`,children:`Global audit`}),(0,Z.jsxs)(`span`,{className:`review-heading-actions`,children:[(0,Z.jsxs)(`small`,{children:[qe.length,`/`,y.findings.length,` categories`]}),(0,Z.jsx)($,{label:`Previous audit sample`,disabled:!K.length,onClick:()=>Rt(-1),children:(0,Z.jsx)(he,{size:14})}),(0,Z.jsx)($,{label:`Next audit sample`,disabled:!K.length,onClick:()=>Rt(1),children:(0,Z.jsx)(le,{size:14})})]})]}),(0,Z.jsxs)(`div`,{className:`audit-totals`,children:[(0,Z.jsxs)(`span`,{children:[(0,Z.jsx)(`b`,{children:y.totals.errors}),` errors`]}),(0,Z.jsxs)(`span`,{children:[(0,Z.jsx)(`b`,{children:y.totals.warnings}),` warnings`]}),(0,Z.jsxs)(`span`,{children:[(0,Z.jsx)(`b`,{children:y.statefulPlacements.toLocaleString()}),` stateful`]})]}),(0,Z.jsxs)(`div`,{className:`review-filter-row`,children:[(0,Z.jsx)(ot,{size:13}),(0,Z.jsx)(`input`,{"aria-label":`Filter audit findings`,value:_e,onChange:e=>C(t=>({...t,auditQuery:e.target.value,focusedFindingCode:void 0,focusedFindingIndex:void 0})),placeholder:`Filter code, message, coordinate`}),(0,Z.jsxs)(`select`,{"aria-label":`Audit severity`,value:ve,onChange:e=>C(t=>({...t,auditSeverity:e.target.value,focusedFindingCode:void 0,focusedFindingIndex:void 0})),children:[(0,Z.jsx)(`option`,{value:`all`,children:`All severity`}),(0,Z.jsx)(`option`,{value:`error`,children:`Errors`}),(0,Z.jsx)(`option`,{value:`warning`,children:`Warnings`}),(0,Z.jsx)(`option`,{value:`info`,children:`Info`})]})]}),(0,Z.jsx)(`div`,{className:`audit-findings`,children:qe.length?qe.map(e=>(0,Z.jsxs)(`article`,{className:w.focusedFindingCode===e.code?`active`:``,children:[(0,Z.jsxs)(`button`,{type:`button`,className:`audit-finding-main`,disabled:!e.coordinates.length,onClick:()=>e.coordinates.length&&Lt({finding:e,coordinate:e.coordinates[0],coordinateIndex:0}),children:[(0,Z.jsx)(`span`,{className:`audit-dot ${e.severity}`}),(0,Z.jsxs)(`span`,{children:[(0,Z.jsx)(`strong`,{children:e.code.replaceAll(`_`,` `)}),(0,Z.jsxs)(`small`,{children:[e.total.toLocaleString(),` affected · `,e.coordinates.length.toLocaleString(),` sampled`]}),(0,Z.jsx)(`small`,{children:e.message})]}),e.coordinates.length?(0,Z.jsx)(nt,{size:13}):null]}),e.coordinates.length>0&&(0,Z.jsxs)(`div`,{className:`audit-samples`,"aria-label":`${e.code} sampled coordinates`,children:[e.coordinates.slice(0,6).map((t,n)=>(0,Z.jsx)(`button`,{type:`button`,className:w.focusedFindingCode===e.code&&w.focusedFindingIndex===n?`active`:``,onClick:()=>Lt({finding:e,coordinate:t,coordinateIndex:n}),children:Q(t)},Q(t))),e.coordinates.length>6&&(0,Z.jsxs)(`span`,{children:[`+`,e.coordinates.length-6,` more via next`]})]})]},e.code)):y.findings.length?(0,Z.jsx)(`p`,{className:`review-empty`,children:`No audit categories match these filters.`}):(0,Z.jsxs)(`div`,{className:`review-pass`,children:[(0,Z.jsx)(ke,{size:16}),`No structural audit findings`]})})]}),(0,Z.jsxs)(`section`,{className:`review-history-section`,children:[(0,Z.jsxs)(`div`,{className:`review-section-heading`,children:[(0,Z.jsx)(`span`,{className:`panel-kicker`,children:`Annotation history`}),(0,Z.jsxs)(`span`,{className:`review-heading-actions`,children:[(0,Z.jsxs)(`small`,{children:[on,` open · `,k.length-on,` resolved`]}),I&&(0,Z.jsxs)(`button`,{type:`button`,className:`review-text-button`,onClick:Ht,children:[(0,Z.jsx)(ct,{size:12}),`Undo`]})]})]}),(0,Z.jsxs)(`div`,{className:`review-filter-row`,children:[(0,Z.jsx)(ot,{size:13}),(0,Z.jsx)(`input`,{"aria-label":`Filter annotations`,value:ye,onChange:e=>C(t=>({...t,annotationQuery:e.target.value})),placeholder:`Filter notes, block, coordinate`}),(0,Z.jsxs)(`select`,{"aria-label":`Annotation category`,value:Ae,onChange:e=>C(t=>({...t,annotationCategory:e.target.value})),children:[(0,Z.jsx)(`option`,{value:`all`,children:`All categories`}),lt.map(e=>(0,Z.jsx)(`option`,{value:e,children:e},e))]}),(0,Z.jsxs)(`select`,{"aria-label":`Annotation status`,value:Ne,onChange:e=>C(t=>({...t,annotationStatus:e.target.value})),children:[(0,Z.jsx)(`option`,{value:`all`,children:`All status`}),(0,Z.jsx)(`option`,{value:`open`,children:`Open`}),(0,Z.jsx)(`option`,{value:`resolved`,children:`Resolved`})]})]}),(0,Z.jsx)(`div`,{className:`review-history`,children:Je.length?Je.map(e=>(0,Z.jsxs)(`article`,{className:e.resolved?`resolved`:``,children:[(0,Z.jsxs)(`button`,{type:`button`,className:`review-history-focus`,onClick:()=>{let t=e.pickedBlock?v.placements.find(t=>t.block===e.pickedBlock&&t.x>=e.bounds.min.x&&t.x<=e.bounds.max.x&&t.y>=e.bounds.min.y&&t.y<=e.bounds.max.y&&t.z>=e.bounds.min.z&&t.z<=e.bounds.max.z):void 0;C(n=>({...n,selection:{...e.bounds,type:e.bounds.min.x===e.bounds.max.x&&e.bounds.min.y===e.bounds.max.y&&e.bounds.min.z===e.bounds.max.z?`block`:`region`,blockCount:e.blockCount,pickedBlock:e.pickedBlock,pickedState:e.pickedState,pickedPhase:t?.phase},anchor:void 0})),Ft(e.bounds)},children:[(0,Z.jsx)(`i`,{style:{background:Zt[e.category]}}),(0,Z.jsxs)(`span`,{children:[(0,Z.jsxs)(`strong`,{children:[e.resolved?`Resolved · `:``,e.category,` · `,e.blockCount,` block`,e.blockCount===1?``:`s`]}),(0,Z.jsx)(`small`,{children:e.note||Q(e.bounds.min)}),(0,Z.jsxs)(`small`,{children:[Q(e.bounds.min),tn(e.bounds.min,e.bounds.max)?``:` → ${Q(e.bounds.max)}`]})]})]}),(0,Z.jsxs)(`div`,{className:`review-history-actions`,children:[(0,Z.jsx)(`button`,{type:`button`,"aria-label":`Edit annotation ${e.note}`,title:`Edit annotation`,onClick:()=>X(e),children:(0,Z.jsx)(it,{size:13})}),(0,Z.jsx)(`button`,{type:`button`,"aria-label":e.resolved?`Reopen annotation`:`Mark annotation resolved`,title:e.resolved?`Reopen`:`Mark resolved`,onClick:()=>Ut(e),children:e.resolved?(0,Z.jsx)(at,{size:13}):(0,Z.jsx)(Ze,{size:13})}),(0,Z.jsx)(`button`,{type:`button`,"aria-label":`Delete annotation ${e.note}`,title:`Delete annotation`,onClick:()=>Vt(e),children:(0,Z.jsx)(st,{size:13})})]})]},e.id)):k.length?(0,Z.jsx)(`p`,{className:`review-empty`,children:`No annotations match these filters.`}):(0,Z.jsx)(`p`,{className:`review-empty`,children:`No annotations yet.`})})]})]}),(0,Z.jsxs)(`footer`,{className:`review-status`,children:[(0,Z.jsxs)(`span`,{children:[(0,Z.jsx)(`i`,{}),`Ready`]}),(0,Z.jsx)(`span`,{children:T===`orbit`?`Orbit, pan, and zoom`:ge?`Choose the second point`:`Review mode: ${T}`}),(0,Z.jsx)(`span`,{children:V}),(0,Z.jsxs)(`strong`,{children:[We.toLocaleString(),` visible · `,on,` open · `,v.hash.slice(0,8)]}),(0,Z.jsx)(pe,{size:16})]})]})})}r((0,G.createElement)(un));