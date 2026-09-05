import{O as e,T as t}from"./v4-BJmWi5kg.js";import{c as n,d as r,i,n as a,o,r as s}from"./helpers-z9v0JHte.js";import{A as c,B as l,C as u,D as d,E as f,F as p,G as m,H as h,I as g,L as _,M as v,N as y,O as b,P as x,R as ee,S,T as C,U as w,V as T,W as E,_ as D,a as te,b as O,c as ne,d as re,f as ie,g as k,h as ae,i as oe,j as se,k as A,l as ce,m as j,n as le,o as ue,p as de,r as fe,s as pe,t as me,u as he,v as ge,w as _e,x as ve,y as ye,z as be}from"./use-paged-build-DwX-ilMD.js";import{i as xe,n as Se,r as Ce,t as we}from"./maximize-2-mOkU6x6e.js";import{n as Te,r as Ee,t as De}from"./x-De2f5xR8.js";import{n as Oe,t as ke}from"./circle-check-r6gchvZf.js";import{i as Ae,n as je,r as Me,t as Ne}from"./resource-pack-B4c4fQQK.js";var Pe=parseInt(`179`.replace(/\D+/g,``)),Fe=Pe>=125?`uv1`:`uv2`,Ie=new ve,M=new w,N=class extends f{constructor(){super(),this.isLineSegmentsGeometry=!0,this.type=`LineSegmentsGeometry`,this.setIndex([0,2,1,2,3,1,2,4,3,4,5,3,4,6,5,6,7,5]),this.setAttribute(`position`,new C([-1,2,0,1,2,0,-1,1,0,1,1,0,-1,0,0,1,0,0,-1,-1,0,1,-1,0],3)),this.setAttribute(`uv`,new C([-1,2,1,2,-1,1,1,1,-1,-1,1,-1,-1,-2,1,-2],2))}applyMatrix4(e){let t=this.attributes.instanceStart,n=this.attributes.instanceEnd;return t!==void 0&&(t.applyMatrix4(e),n.applyMatrix4(e),t.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}setPositions(e){let t;e instanceof Float32Array?t=e:Array.isArray(e)&&(t=new Float32Array(e));let n=new d(t,6,1);return this.setAttribute(`instanceStart`,new b(n,3,0)),this.setAttribute(`instanceEnd`,new b(n,3,3)),this.computeBoundingBox(),this.computeBoundingSphere(),this}setColors(e,t=3){let n;e instanceof Float32Array?n=e:Array.isArray(e)&&(n=new Float32Array(e));let r=new d(n,t*2,1);return this.setAttribute(`instanceColorStart`,new b(r,t,0)),this.setAttribute(`instanceColorEnd`,new b(r,t,t)),this}fromWireframeGeometry(e){return this.setPositions(e.attributes.position.array),this}fromEdgesGeometry(e){return this.setPositions(e.attributes.position.array),this}fromMesh(e){return this.fromWireframeGeometry(new m(e.geometry)),this}fromLineSegments(e){let t=e.geometry;return this.setPositions(t.attributes.position.array),this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new ve);let e=this.attributes.instanceStart,t=this.attributes.instanceEnd;e!==void 0&&t!==void 0&&(this.boundingBox.setFromBufferAttribute(e),Ie.setFromBufferAttribute(t),this.boundingBox.union(Ie))}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new be),this.boundingBox===null&&this.computeBoundingBox();let e=this.attributes.instanceStart,t=this.attributes.instanceEnd;if(e!==void 0&&t!==void 0){let n=this.boundingSphere.center;this.boundingBox.getCenter(n);let r=0;for(let i=0,a=e.count;i<a;i++)M.fromBufferAttribute(e,i),r=Math.max(r,n.distanceToSquared(M)),M.fromBufferAttribute(t,i),r=Math.max(r,n.distanceToSquared(M));this.boundingSphere.radius=Math.sqrt(r),isNaN(this.boundingSphere.radius)&&console.error(`THREE.LineSegmentsGeometry.computeBoundingSphere(): Computed radius is NaN. The instanced position data is likely to have NaN values.`,this)}}toJSON(){}applyMatrix(e){return console.warn(`THREE.LineSegmentsGeometry: applyMatrix() has been renamed to applyMatrix4().`),this.applyMatrix4(e)}},P=class extends N{constructor(){super(),this.isLineGeometry=!0,this.type=`LineGeometry`}setPositions(e){let t=e.length-3,n=new Float32Array(2*t);for(let r=0;r<t;r+=3)n[2*r]=e[r],n[2*r+1]=e[r+1],n[2*r+2]=e[r+2],n[2*r+3]=e[r+3],n[2*r+4]=e[r+4],n[2*r+5]=e[r+5];return super.setPositions(n),this}setColors(e,t=3){let n=e.length-t,r=new Float32Array(2*n);if(t===3)for(let i=0;i<n;i+=t)r[2*i]=e[i],r[2*i+1]=e[i+1],r[2*i+2]=e[i+2],r[2*i+3]=e[i+3],r[2*i+4]=e[i+4],r[2*i+5]=e[i+5];else for(let i=0;i<n;i+=t)r[2*i]=e[i],r[2*i+1]=e[i+1],r[2*i+2]=e[i+2],r[2*i+3]=e[i+3],r[2*i+4]=e[i+4],r[2*i+5]=e[i+5],r[2*i+6]=e[i+6],r[2*i+7]=e[i+7];return super.setColors(r,t),this}fromLine(e){let t=e.geometry;return this.setPositions(t.attributes.position.array),this}},Le=class extends ee{constructor(e){super({type:`LineMaterial`,uniforms:T.clone(T.merge([O.common,O.fog,{worldUnits:{value:1},linewidth:{value:1},resolution:{value:new h(1,1)},dashOffset:{value:0},dashScale:{value:1},dashSize:{value:1},gapSize:{value:1}}])),vertexShader:`
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
					#include <${Pe>=154?`colorspace_fragment`:`encodings_fragment`}>
					#include <fog_fragment>
					#include <premultiplied_alpha_fragment>

				}
			`,clipping:!0}),this.isLineMaterial=!0,this.onBeforeCompile=function(){this.transparent?this.defines.USE_LINE_COLOR_ALPHA=`1`:delete this.defines.USE_LINE_COLOR_ALPHA},Object.defineProperties(this,{color:{enumerable:!0,get:function(){return this.uniforms.diffuse.value},set:function(e){this.uniforms.diffuse.value=e}},worldUnits:{enumerable:!0,get:function(){return`WORLD_UNITS`in this.defines},set:function(e){e===!0?this.defines.WORLD_UNITS=``:delete this.defines.WORLD_UNITS}},linewidth:{enumerable:!0,get:function(){return this.uniforms.linewidth.value},set:function(e){this.uniforms.linewidth.value=e}},dashed:{enumerable:!0,get:function(){return`USE_DASH`in this.defines},set(e){!!e!=`USE_DASH`in this.defines&&(this.needsUpdate=!0),e===!0?this.defines.USE_DASH=``:delete this.defines.USE_DASH}},dashScale:{enumerable:!0,get:function(){return this.uniforms.dashScale.value},set:function(e){this.uniforms.dashScale.value=e}},dashSize:{enumerable:!0,get:function(){return this.uniforms.dashSize.value},set:function(e){this.uniforms.dashSize.value=e}},dashOffset:{enumerable:!0,get:function(){return this.uniforms.dashOffset.value},set:function(e){this.uniforms.dashOffset.value=e}},gapSize:{enumerable:!0,get:function(){return this.uniforms.gapSize.value},set:function(e){this.uniforms.gapSize.value=e}},opacity:{enumerable:!0,get:function(){return this.uniforms.opacity.value},set:function(e){this.uniforms.opacity.value=e}},resolution:{enumerable:!0,get:function(){return this.uniforms.resolution.value},set:function(e){this.uniforms.resolution.value.copy(e)}},alphaToCoverage:{enumerable:!0,get:function(){return`USE_ALPHA_TO_COVERAGE`in this.defines},set:function(e){!!e!=`USE_ALPHA_TO_COVERAGE`in this.defines&&(this.needsUpdate=!0),e===!0?(this.defines.USE_ALPHA_TO_COVERAGE=``,this.extensions.derivatives=!0):(delete this.defines.USE_ALPHA_TO_COVERAGE,this.extensions.derivatives=!1)}}}),this.setValues(e)}},Re=new E,F=new w,I=new w,L=new E,R=new E,z=new E,ze=new w,Be=new se,B=new A,Ve=new w,He=new ve,Ue=new be,V=new E,H,U;function We(e,t,n){return V.set(0,0,-t,1).applyMatrix4(e.projectionMatrix),V.multiplyScalar(1/V.w),V.x=U/n.width,V.y=U/n.height,V.applyMatrix4(e.projectionMatrixInverse),V.multiplyScalar(1/V.w),Math.abs(Math.max(V.x,V.y))}function Ge(e,t){let n=e.matrixWorld,r=e.geometry,i=r.attributes.instanceStart,a=r.attributes.instanceEnd,o=Math.min(r.instanceCount,i.count);for(let r=0,s=o;r<s;r++){B.start.fromBufferAttribute(i,r),B.end.fromBufferAttribute(a,r),B.applyMatrix4(n);let o=new w,s=new w;H.distanceSqToSegment(B.start,B.end,s,o),s.distanceTo(o)<U*.5&&t.push({point:s,pointOnLine:o,distance:H.origin.distanceTo(s),object:e,face:null,faceIndex:r,uv:null,[Fe]:null})}}function Ke(e,t,n){let r=t.projectionMatrix,i=e.material.resolution,a=e.matrixWorld,o=e.geometry,s=o.attributes.instanceStart,l=o.attributes.instanceEnd,u=Math.min(o.instanceCount,s.count),d=-t.near;H.at(1,z),z.w=1,z.applyMatrix4(t.matrixWorldInverse),z.applyMatrix4(r),z.multiplyScalar(1/z.w),z.x*=i.x/2,z.y*=i.y/2,z.z=0,ze.copy(z),Be.multiplyMatrices(t.matrixWorldInverse,a);for(let t=0,o=u;t<o;t++){if(L.fromBufferAttribute(s,t),R.fromBufferAttribute(l,t),L.w=1,R.w=1,L.applyMatrix4(Be),R.applyMatrix4(Be),L.z>d&&R.z>d)continue;if(L.z>d){let e=L.z-R.z,t=(L.z-d)/e;L.lerp(R,t)}else if(R.z>d){let e=R.z-L.z,t=(R.z-d)/e;R.lerp(L,t)}L.applyMatrix4(r),R.applyMatrix4(r),L.multiplyScalar(1/L.w),R.multiplyScalar(1/R.w),L.x*=i.x/2,L.y*=i.y/2,R.x*=i.x/2,R.y*=i.y/2,B.start.copy(L),B.start.z=0,B.end.copy(R),B.end.z=0;let o=B.closestPointToPointParameter(ze,!0);B.at(o,Ve);let u=c.lerp(L.z,R.z,o),f=u>=-1&&u<=1,p=ze.distanceTo(Ve)<U*.5;if(f&&p){B.start.fromBufferAttribute(s,t),B.end.fromBufferAttribute(l,t),B.start.applyMatrix4(a),B.end.applyMatrix4(a);let r=new w,i=new w;H.distanceSqToSegment(B.start,B.end,i,r),n.push({point:i,pointOnLine:r,distance:H.origin.distanceTo(i),object:e,face:null,faceIndex:t,uv:null,[Fe]:null})}}}var qe=class extends v{constructor(e=new N,t=new Le({color:Math.random()*16777215})){super(e,t),this.isLineSegments2=!0,this.type=`LineSegments2`}computeLineDistances(){let e=this.geometry,t=e.attributes.instanceStart,n=e.attributes.instanceEnd,r=new Float32Array(2*t.count);for(let e=0,i=0,a=t.count;e<a;e++,i+=2)F.fromBufferAttribute(t,e),I.fromBufferAttribute(n,e),r[i]=i===0?0:r[i-1],r[i+1]=r[i]+F.distanceTo(I);let i=new d(r,2,1);return e.setAttribute(`instanceDistanceStart`,new b(i,1,0)),e.setAttribute(`instanceDistanceEnd`,new b(i,1,1)),this}raycast(e,t){let n=this.material.worldUnits,r=e.camera;r===null&&!n&&console.error(`LineSegments2: "Raycaster.camera" needs to be set in order to raycast against LineSegments2 while worldUnits is set to false.`);let i=e.params.Line2===void 0?0:e.params.Line2.threshold||0;H=e.ray;let a=this.matrixWorld,o=this.geometry,s=this.material;U=s.linewidth+i,o.boundingSphere===null&&o.computeBoundingSphere(),Ue.copy(o.boundingSphere).applyMatrix4(a);let c;if(c=n?U*.5:We(r,Math.max(r.near,Ue.distanceToPoint(H.origin)),s.resolution),Ue.radius+=c,H.intersectsSphere(Ue)===!1)return;o.boundingBox===null&&o.computeBoundingBox(),He.copy(o.boundingBox).applyMatrix4(a);let l;l=n?U*.5:We(r,Math.max(r.near,He.distanceToPoint(H.origin)),s.resolution),He.expandByScalar(l),H.intersectsBox(He)!==!1&&(n?Ge(this,t):Ke(this,r,t))}onBeforeRender(e){let t=this.material.uniforms;t&&t.resolution&&(e.getViewport(Re),this.material.uniforms.resolution.value.set(Re.z,Re.w))}},Je=class extends qe{constructor(e=new P,t=new Le({color:Math.random()*16777215})){super(e,t),this.isLine2=!0,this.type=`Line2`}},W=e(r()),G=W.forwardRef(function({points:e,color:t=16777215,vertexColors:n,linewidth:r,lineWidth:i,segments:a,dashed:o,...s},c){var l;let u=ye(e=>e.size),d=W.useMemo(()=>a?new qe:new Je,[a]),[f]=W.useState(()=>new Le),p=(n==null||(l=n[0])==null?void 0:l.length)===4?4:3,m=W.useMemo(()=>{let r=a?new N:new P,i=e.map(e=>{let t=Array.isArray(e);return e instanceof w||e instanceof E?[e.x,e.y,e.z]:e instanceof h?[e.x,e.y,0]:t&&e.length===3?[e[0],e[1],e[2]]:t&&e.length===2?[e[0],e[1],0]:e});if(r.setPositions(i.flat()),n){t=16777215;let e=n.map(e=>e instanceof S?e.toArray():e);r.setColors(e.flat(),p)}return r},[e,a,n,p]);return W.useLayoutEffect(()=>{d.computeLineDistances()},[e,d]),W.useLayoutEffect(()=>{o?f.defines.USE_DASH=``:delete f.defines.USE_DASH,f.needsUpdate=!0},[o,f]),W.useEffect(()=>()=>{m.dispose(),f.dispose()},[m]),W.createElement(`primitive`,D({object:d,ref:c},s),W.createElement(`primitive`,{object:m,attach:`geometry`}),W.createElement(`primitive`,D({object:f,attach:`material`,color:t,vertexColors:!!n,resolution:[u.width,u.height],linewidth:r??i??1,dashed:o,transparent:p===4},s)))}),Ye=W.forwardRef(({threshold:e=15,geometry:t,...n},r)=>{let i=W.useRef(null);W.useImperativeHandle(r,()=>i.current,[]);let a=W.useMemo(()=>[0,0,0,1,0,0],[]),o=W.useRef(null),s=W.useRef(null);return W.useLayoutEffect(()=>{let n=i.current.parent,r=t??n?.geometry;if(!r||o.current===r&&s.current===e)return;o.current=r,s.current=e;let a=new u(r,e).attributes.position.array;i.current.geometry.setPositions(a),i.current.geometry.attributes.instanceStart.needsUpdate=!0,i.current.geometry.attributes.instanceEnd.needsUpdate=!0,i.current.computeLineDistances()}),W.createElement(G,D({segments:!0,points:a,ref:i,raycast:()=>null},n))});function Xe(e,t){let n=e+`Geometry`;return W.forwardRef(({args:e,children:r,...i},a)=>{let o=W.useRef(null);return W.useImperativeHandle(a,()=>o.current),W.useLayoutEffect(()=>void t?.(o.current)),W.createElement(`mesh`,D({ref:o},i),W.createElement(n,{attach:`geometry`,args:e}),r)})}var Ze=Xe(`box`),Qe=s(`circle-question-mark`,[[`circle`,{cx:`12`,cy:`12`,r:`10`,key:`1mglay`}],[`path`,{d:`M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3`,key:`1u773s`}],[`path`,{d:`M12 17h.01`,key:`p32p05`}]]),$e=s(`circle`,[[`circle`,{cx:`12`,cy:`12`,r:`10`,key:`1mglay`}]]),et=s(`clipboard`,[[`rect`,{width:`8`,height:`4`,x:`8`,y:`2`,rx:`1`,ry:`1`,key:`tgr4d6`}],[`path`,{d:`M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2`,key:`116196`}]]),tt=s(`crosshair`,[[`circle`,{cx:`12`,cy:`12`,r:`10`,key:`1mglay`}],[`line`,{x1:`22`,x2:`18`,y1:`12`,y2:`12`,key:`l9bcsi`}],[`line`,{x1:`6`,x2:`2`,y1:`12`,y2:`12`,key:`13hhkx`}],[`line`,{x1:`12`,x2:`12`,y1:`6`,y2:`2`,key:`10w3f3`}],[`line`,{x1:`12`,x2:`12`,y1:`22`,y2:`18`,key:`15g9kq`}]]),nt=s(`file-input`,[[`path`,{d:`M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4`,key:`1pf5j1`}],[`path`,{d:`M14 2v4a2 2 0 0 0 2 2h4`,key:`tnqrlb`}],[`path`,{d:`M2 15h10`,key:`jfw4w8`}],[`path`,{d:`m9 18 3-3-3-3`,key:`112psh`}]]),rt=s(`focus`,[[`circle`,{cx:`12`,cy:`12`,r:`3`,key:`1v7zrd`}],[`path`,{d:`M3 7V5a2 2 0 0 1 2-2h2`,key:`aa7l1z`}],[`path`,{d:`M17 3h2a2 2 0 0 1 2 2v2`,key:`4qcy5o`}],[`path`,{d:`M21 17v2a2 2 0 0 1-2 2h-2`,key:`6vwrx8`}],[`path`,{d:`M7 21H5a2 2 0 0 1-2-2v-2`,key:`ioqczr`}]]),it=s(`locate-fixed`,[[`line`,{x1:`2`,x2:`5`,y1:`12`,y2:`12`,key:`bvdh0s`}],[`line`,{x1:`19`,x2:`22`,y1:`12`,y2:`12`,key:`1tbv5k`}],[`line`,{x1:`12`,x2:`12`,y1:`2`,y2:`5`,key:`11lu5j`}],[`line`,{x1:`12`,x2:`12`,y1:`19`,y2:`22`,key:`x3vr5v`}],[`circle`,{cx:`12`,cy:`12`,r:`7`,key:`fim9np`}],[`circle`,{cx:`12`,cy:`12`,r:`3`,key:`1v7zrd`}]]),at=s(`orbit`,[[`path`,{d:`M20.341 6.484A10 10 0 0 1 10.266 21.85`,key:`1enhxb`}],[`path`,{d:`M3.659 17.516A10 10 0 0 1 13.74 2.152`,key:`1crzgf`}],[`circle`,{cx:`12`,cy:`12`,r:`3`,key:`1v7zrd`}],[`circle`,{cx:`19`,cy:`5`,r:`2`,key:`mhkx31`}],[`circle`,{cx:`5`,cy:`19`,r:`2`,key:`v8kfzx`}]]),ot=s(`pen-line`,[[`path`,{d:`M13 21h8`,key:`1jsn5i`}],[`path`,{d:`M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z`,key:`1a8usu`}]]),st=s(`rotate-ccw`,[[`path`,{d:`M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8`,key:`1357e3`}],[`path`,{d:`M3 3v5h5`,key:`1xhq8a`}]]),ct=s(`search`,[[`path`,{d:`m21 21-4.34-4.34`,key:`14j7rj`}],[`circle`,{cx:`11`,cy:`11`,r:`8`,key:`4ej97u`}]]),lt=s(`trash-2`,[[`path`,{d:`M10 11v6`,key:`nco0om`}],[`path`,{d:`M14 11v6`,key:`outv1u`}],[`path`,{d:`M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6`,key:`miytrc`}],[`path`,{d:`M3 6h18`,key:`d0wm0j`}],[`path`,{d:`M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2`,key:`e791ji`}]]),ut=s(`undo-2`,[[`path`,{d:`M9 14 4 9l5-5`,key:`102s5s`}],[`path`,{d:`M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11`,key:`f3b9sd`}]]);t(((e,t)=>{t.exports={}}))(),`${Object.keys({one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19,twenty:20,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,eighty:80,ninety:90,hundred:100}).join(`|`)}`;var dt=[`change`,`fix`,`remove`,`liked`],ft=1e6,pt=4e3;function K(e){return typeof e==`object`&&!!e&&!Array.isArray(e)}function mt(e){return K(e)&&[e.x,e.y,e.z].every(e=>typeof e==`number`&&Number.isSafeInteger(e))}function q(e,t){return e.x>=t.min.x&&e.x<=t.max.x&&e.y>=t.min.y&&e.y<=t.max.y&&e.z>=t.min.z&&e.z<=t.max.z}function ht(e){return e.min.x<=e.max.x&&e.min.y<=e.max.y&&e.min.z<=e.max.z}function gt(e){return JSON.stringify(Object.entries(e??{}).sort(([e],[t])=>e.localeCompare(t)))}function _t(e){return K(e)&&Object.keys(e).length<=64&&Object.entries(e).every(([e,t])=>e.length>0&&e.length<=100&&(typeof t==`boolean`||typeof t==`number`&&Number.isFinite(t)||typeof t==`string`&&t.length<=256))}function J(e){return typeof e==`string`&&e.length<=64&&Number.isFinite(Date.parse(e))}function Y(e){throw Error(`Invalid review: ${e}`)}function vt(e,t){return e.placements.reduce((e,n)=>e+ +!!q(n,t),0)}function yt(e,t){let n=e.max.x-e.min.x+1,r=e.max.y-e.min.y+1,i=e.max.z-e.min.z+1,a=Math.max(0,n*r*i);return{width:n,height:r,depth:i,volume:a,blockCount:t,density:a?t/a:0}}function bt(e){let t=e.max.x-e.min.x,n=e.max.y-e.min.y,r=e.max.z-e.min.z;return{dx:t,dy:n,dz:r,horizontal:Math.hypot(t,r),direct:Math.hypot(t,n,r),manhattan:Math.abs(t)+Math.abs(n)+Math.abs(r)}}function xt(e){let t=e.trim(),n=t.match(/^(-?\d+)\s*(?:,|\s)\s*(-?\d+)\s*(?:,|\s)\s*(-?\d+)$/)??t.match(/^x\s*=\s*(-?\d+)\s*[,; ]+y\s*=\s*(-?\d+)\s*[,; ]+z\s*=\s*(-?\d+)$/i)??t.match(/^\/?tp\s+(?:@[pares](?:\[[^\]]*\])?\s+)?(-?\d+)\s+(-?\d+)\s+(-?\d+)$/i);if(!n)return;let[r,i,a]=n.slice(1).map(Number);return[r,i,a].every(Number.isSafeInteger)?{x:r,y:i,z:a}:void 0}function St(e,t){let n=t.trim().toLowerCase().replace(/^minecraft:/,``);if(n.length<2)return{matches:[],capped:!1,tooShort:!!n};let r=[],i=!1;for(let t of e){let e=t.block.replace(`minecraft:`,``),a=Object.entries(t.state??{}).sort(([e],[t])=>e.localeCompare(t)).map(([e,t])=>`${e}=${String(t)}`).join(` `);if(`${e} ${e.replaceAll(`_`,` `)} ${t.phase} ${a}`.toLowerCase().includes(n)){if(r.length===500){i=!0;break}r.push(t)}}return{matches:r,capped:i,tooShort:!1}}function Ct(e,t){let n=typeof e.reviewBuildId==`string`,r=typeof e.reviewBuildHash==`string`;return!n&&!r?`unbound`:!n||!r?`different`:e.reviewBuildId===t.id&&e.reviewBuildHash===t.hash?`current`:`different`}function wt(e,t){let n=`review_${(t??globalThis.crypto?.randomUUID?.()??`${Date.now().toString(36)}_${Math.random().toString(36).slice(2,12)}`).replace(/[^A-Za-z0-9._:]/g,`_`).slice(0,96)||`annotation`}`,r=new Set(e);if(!r.has(n))return n;let i=2;for(;r.has(`${n}_${i}`);)i+=1;return`${n}_${i}`}function Tt(e,t,n){if(e.length>=500)return;let r=wt(e.map(e=>e.id),n);return[{...t,id:r},...e]}function Et(e,t){K(e)||Y(`the JSON root must be an object.`),(e.type!==`blockwright-review`||e.schemaVersion!==1)&&Y(`unsupported type or schema version.`),(!K(e.build)||e.build.hash!==t.hash)&&Y(`the immutable build hash does not match this build.`),(typeof e.build.id!=`string`||e.build.id!==t.id)&&Y(`the build id does not match this build.`),Array.isArray(e.annotations)||Y(`annotations must be an array.`),e.annotations.length>500&&Y(`at most 500 annotations may be imported at once.`),e.annotations.length*t.placements.length>12e6&&Y(`this annotation/build combination is too large to validate safely in the reviewer; split the review into smaller files.`);let n=new Set;return e.annotations.map((e,r)=>{let i=`annotation ${r+1}`;K(e)||Y(`${i} must be an object.`),(typeof e.id!=`string`||!/^[A-Za-z0-9._:-]{1,128}$/.test(e.id))&&Y(`${i} has an invalid id.`),n.has(e.id)&&Y(`${i} repeats id ${e.id}.`),n.add(e.id),(typeof e.category!=`string`||!dt.includes(e.category))&&Y(`${i} has an unsupported category.`),(typeof e.note!=`string`||e.note.length>4e3)&&Y(`${i} has an invalid or oversized note.`),J(e.createdAt)||Y(`${i} has an invalid createdAt timestamp.`),e.updatedAt!==void 0&&!J(e.updatedAt)&&Y(`${i} has an invalid updatedAt timestamp.`),e.resolved!==void 0&&typeof e.resolved!=`boolean`&&Y(`${i} has an invalid resolved flag.`),(!K(e.bounds)||!mt(e.bounds.min)||!mt(e.bounds.max))&&Y(`${i} bounds must contain exact integer coordinates.`);let a={min:{...e.bounds.min},max:{...e.bounds.max}};ht(a)||Y(`${i} bounds are reversed.`),(!q(a.min,t.bounds)||!q(a.max,t.bounds))&&Y(`${i} is outside the immutable build bounds.`);let o=vt(t,a);if((typeof e.blockCount!=`number`||!Number.isSafeInteger(e.blockCount)||e.blockCount!==o)&&Y(`${i} block count does not match the canonical build.`),e.pickedBlock!==void 0&&(typeof e.pickedBlock!=`string`||e.pickedBlock.length>200)&&Y(`${i} has an invalid picked block.`),e.pickedState!==void 0&&!_t(e.pickedState)&&Y(`${i} has an invalid picked state.`),e.pickedState!==void 0&&e.pickedBlock===void 0&&Y(`${i} has block state without a picked block.`),e.pickedBlock!==void 0){let n=e.pickedState===void 0?void 0:gt(e.pickedState);t.placements.some(t=>q(t,a)&&t.block===e.pickedBlock&&(n===void 0||gt(t.state)===n))||Y(`${i} picked block or state is not canonical within its bounds.`)}return{id:e.id,category:e.category,note:e.note,bounds:a,blockCount:e.blockCount,...e.pickedBlock===void 0?{}:{pickedBlock:e.pickedBlock},...e.pickedState===void 0?{}:{pickedState:{...e.pickedState}},createdAt:e.createdAt,...e.resolved===void 0?{}:{resolved:e.resolved},...e.updatedAt===void 0?{}:{updatedAt:e.updatedAt}}})}function Dt(e,t){let n=t?.input.rolePalette?.roof;return e.block===n||/roof|eave|ridge|gable|tile|finial|soffit/i.test(e.phase)||/roof_tile/.test(e.block)}var Ot=`blockwright-reviewer-3d-lease-v1`,kt=`blockwright:reviewer:3d-lease:v1`,At=`blockwright-reviewer-3d-active`;function jt(e,t){return e&&t===`fullscreen`}function Mt(e,t=Date.now()){return{type:At,token:e,activatedAt:t}}function Nt(e,t){if(!e||typeof e!=`object`)return!1;let n=e;return n.type===`blockwright-reviewer-3d-active`&&typeof n.token==`string`&&n.token.length>0&&n.token!==t&&typeof n.activatedAt==`number`&&Number.isFinite(n.activatedAt)}function Pt(e,t=4){let n=Object.entries(e).sort(([,e],[,t])=>t-e||0),r=Number.isSafeInteger(t)&&t>0?t:4;return{materialCount:n.length,visible:n.slice(0,r),hiddenCount:Math.max(0,n.length-r)}}var Ft=new Set([`north`,`south`,`west`,`east`]),It={0:`east`,1:`west`,2:`south`,3:`north`},Lt={north:[0,-1],south:[0,1],west:[-1,0],east:[1,0]},Rt={north:0,east:-Math.PI/2,south:Math.PI,west:Math.PI/2},zt={white:`#f0f1ec`,light_gray:`#a7adaf`,gray:`#596166`,black:`#202329`,brown:`#74472f`,red:`#b53b38`,orange:`#e47725`,yellow:`#dfc43b`,lime:`#75b83d`,green:`#3f7d48`,cyan:`#278c9b`,light_blue:`#58a8d3`,blue:`#385ba6`,purple:`#7749a3`,magenta:`#b64c9d`,pink:`#e38da7`},Bt=Object.keys(zt).sort((e,t)=>t.length-e.length);function X(e,t){return e.state?.[t]}function Vt(e,t=!1){return e===!0||e===1||e===`true`||e===`1`?!0:e===!1||e===0||e===`false`||e===`0`?!1:t}function Ht(e,t=`north`){return typeof e==`string`&&Ft.has(e)?e:t}function Ut(e,t=`north`){let n=typeof e==`number`?e:Number(e);return Number.isInteger(n)?It[n]??t:t}function Wt(e,t){let n=t===`bedrock`,r=e.block,i=r.endsWith(`_stairs`)?X(e,`weirdo_direction`):X(e,`direction`),a=n?/_door$/.test(r)&&!/_trapdoor$/.test(r)?Ht(X(e,`minecraft:cardinal_direction`)):Ut(i):Ht(X(e,`facing`)),o=n?Vt(X(e,`upside_down_bit`)):X(e,`half`)===`top`,s=X(e,`minecraft:vertical_half`),c=/_double_slab$/.test(r)?`double`:n?s===`top`?`top`:`bottom`:X(e,`type`)===`double`?`double`:X(e,`type`)===`top`?`top`:`bottom`;return{facing:a,half:o?`top`:`bottom`,hinge:n?Vt(X(e,`door_hinge_bit`))?`right`:`left`:X(e,`hinge`)===`right`?`right`:`left`,doorHalf:n?Vt(X(e,`upper_block_bit`))?`upper`:`lower`:X(e,`half`)===`upper`?`upper`:`lower`,open:Vt(n?X(e,`open_bit`):X(e,`open`)),hanging:Vt(X(e,`hanging`)),slabType:c}}function Gt(e){return[1,3,5].map(t=>Number.parseInt(e.slice(t,t+2),16))}function Kt(e,t,n){let r=Gt(e),i=Gt(t);return`#${r.map((e,t)=>Math.round(e+(i[t]-e)*n).toString(16).padStart(2,`0`)).join(``)}`}function qt(e,t,n){let r=t/100,i=n/100,a=(1-Math.abs(2*i-1))*r,o=e/60,s=a*(1-Math.abs(o%2-1)),[c,l,u]=o<1?[a,s,0]:o<2?[s,a,0]:o<3?[0,a,s]:o<4?[0,s,a]:o<5?[s,0,a]:[a,0,s],d=i-a/2;return`#${[c,l,u].map(e=>Math.round((e+d)*255).toString(16).padStart(2,`0`)).join(``)}`}function Jt(e){let t=2166136261;for(let n=0;n<e.length;n+=1)t^=e.charCodeAt(n),t=Math.imul(t,16777619);return qt(Math.abs(t)%360,24+Math.abs(t>>>8)%19,48+Math.abs(t>>>16)%13)}function Yt(e){let t=e.toLowerCase().replace(/^minecraft:/,``);if(/concrete|wool|terracotta|stained_glass|carpet|candle|shulker_box/.test(t)){let e=Bt.find(e=>RegExp(`(?:^|_)${e}(?:_|$)`).test(t));if(e){let n=zt[e];return/terracotta/.test(t)&&!/glazed/.test(t)?Kt(n,`#7d4c3d`,.36):/glazed_terracotta/.test(t)?Kt(n,`#f0e2d3`,.12):/wool|carpet/.test(t)?Kt(n,`#ebe7dd`,.08):/stained_glass/.test(t)?Kt(n,`#d9f1f2`,.18):/concrete_powder/.test(t)?Kt(n,`#eadfcf`,.1):n}}return/water|bubble_column/.test(t)?`#2387cf`:/packed_ice|blue_ice/.test(t)?`#68b7e6`:/ice/.test(t)?`#a4d8e5`:/glass|pane/.test(t)?`#a7d2d7`:/sea_lantern|lantern|glowstone|froglight|shroomlight|ochre_froglight/.test(t)?`#efba55`:/redstone|magma/.test(t)?`#b84332`:/diamond/.test(t)?`#55d7ce`:/emerald/.test(t)?`#42b86b`:/lapis/.test(t)?`#3659a9`:/gold/.test(t)?`#d7ac35`:/netherite/.test(t)?`#39353a`:/oxidized_copper/.test(t)?`#4f9a83`:/weathered_copper/.test(t)?`#65927c`:/exposed_copper/.test(t)?`#ad7958`:/copper/.test(t)?`#b96342`:/iron|chain|anvil|hopper|cauldron/.test(t)?`#8b9292`:/deepslate|blackstone|coal|basalt/.test(t)?`#30383d`:/quartz|calcite|diorite|bone_block/.test(t)?`#d8d3c6`:/prismarine/.test(t)?`#559687`:/sandstone|sand|end_stone/.test(t)?`#cbb67b`:/granite|brick/.test(t)?`#8d5545`:/stone|tuff|andesite|cobble|gravel/.test(t)?`#747a78`:/warped/.test(t)?`#347b76`:/crimson/.test(t)?`#7c354d`:/mangrove/.test(t)?`#703d32`:/cherry/.test(t)?`#d39a9a`:/spruce|dark_oak/.test(t)?`#49311f`:/jungle|acacia/.test(t)?`#9a5d36`:/oak|bamboo|birch/.test(t)?`#ad8250`:/moss|grass|leaves|vine|cactus|azalea|lily|fern/.test(t)?`#527b4d`:/netherrack|nether_brick/.test(t)?`#63343b`:/snow/.test(t)?`#e6eff0`:/clay/.test(t)?`#9aa5b3`:Jt(t)}function Xt(e,t){let n=e.block,r=Wt(e,t),[i,a]=Lt[r.facing];if(n.endsWith(`_slab`))return r.slabType===`double`?[{size:[1,1,1],offset:[0,0,0]}]:[{size:[1,.5,1],offset:[0,r.slabType===`top`?.25:-.25,0]}];if(n.endsWith(`_stairs`)){let e=r.half===`top`;return[{size:[1,.5,1],offset:[0,e?.25:-.25,0]},{size:[Math.abs(i)?.5:1,.5,Math.abs(a)?.5:1],offset:[i*.25,e?-.25:.25,a*.25]}]}if(n.endsWith(`_trapdoor`))return r.open?[{size:[Math.abs(i)?.1875:1,1,Math.abs(a)?.1875:1],offset:[i*.40625,0,a*.40625]}]:[{size:[1,.1875,1],offset:[0,r.half===`top`?.40625:-.40625,0]}];if(/glass_pane|iron_bars/.test(n)){let t=t=>String(e.state?.[t]??``),n=[{size:[.125,1,.125],offset:[0,0,0]}];return t(`north`)===`true`&&n.push({size:[.125,1,.5],offset:[0,0,-.25]}),t(`south`)===`true`&&n.push({size:[.125,1,.5],offset:[0,0,.25]}),t(`west`)===`true`&&n.push({size:[.5,1,.125],offset:[-.25,0,0]}),t(`east`)===`true`&&n.push({size:[.5,1,.125],offset:[.25,0,0]}),n}if(/_fence$|_wall$/.test(n)){let t=t=>[`true`,`low`,`tall`].includes(String(e.state?.[t]??``)),n=[{size:[.25,1,.25],offset:[0,0,0]}];return t(`north`)&&n.push({size:[.25,.5,.5],offset:[0,.05,-.25]}),t(`south`)&&n.push({size:[.25,.5,.5],offset:[0,.05,.25]}),t(`west`)&&n.push({size:[.5,.5,.25],offset:[-.25,.05,0]}),t(`east`)&&n.push({size:[.5,.5,.25],offset:[.25,.05,0]}),n}if(/_door$/.test(n)&&!/_trapdoor$/.test(n)){let e=Rt[r.facing];if(!r.open)return[{size:[1,1,.1875],offset:[0,0,0],rotationY:e}];let t=r.hinge===`left`?-1:1,n=[-a,i];return[{size:[1,1,.1875],offset:[(n[0]*t+i)*.40625,0,(n[1]*t+a)*.40625],rotationY:e+(r.hinge===`left`?Math.PI/2:-Math.PI/2)}]}return/(^|:)lantern$|soul_lantern$/.test(n)?[{size:[.5,.5,.5],offset:[0,-.05,0],role:`lantern`},{size:[.25,.18,.25],offset:[0,.29,0],role:`metal`},...r.hanging?[{size:[.12,.28,.12],offset:[0,.43,0],role:`metal`}]:[]]:[{size:[1,1,1],offset:[0,0,0]}]}var Z=n(),Zt={change:`#e9ad4f`,fix:`#ef6b5b`,remove:`#c74f76`,liked:`#5ec6a7`};function Qt(){let e=`(max-width: 620px), (pointer: coarse)`,[t,n]=(0,W.useState)(()=>typeof window<`u`&&typeof window.matchMedia==`function`&&window.matchMedia(e).matches);return(0,W.useEffect)(()=>{if(typeof window>`u`||typeof window.matchMedia!=`function`)return;let t=window.matchMedia(e),r=()=>n(t.matches);return r(),t.addEventListener(`change`,r),()=>t.removeEventListener(`change`,r)},[]),t}var Q=({x:e,y:t,z:n})=>`${e},${t},${n}`,$t=e=>e.replace(`minecraft:`,``).split(`_`).map(e=>e[0].toUpperCase()+e.slice(1)).join(` `),en=e=>Object.entries(e??{}).sort(([e],[t])=>e.localeCompare(t)).map(([e,t])=>`${e}=${String(t)}`).join(`, `),tn=(e,t)=>!!(e&&t&&e.x===t.x&&e.y===t.y&&e.z===t.z),nn=e=>({x:(e.min.x+e.max.x)/2,y:(e.min.y+e.max.y)/2,z:(e.min.z+e.max.z)/2});function rn(e){let t=(0,W.useMemo)(()=>{let t=new Map;if(!e)return t;let n=new l;for(let r of e.textures.values())for(let e of Object.values(r)){if(t.has(e))continue;let r=n.load(e);r.colorSpace=_,r.magFilter=x,r.minFilter=p,t.set(e,r)}return t},[e]);return(0,W.useEffect)(()=>()=>{for(let e of t.values())e.dispose()},[t]),t}function an({placements:e,part:t,block:n,textures:r,textureMaps:i,dimmed:a,onPick:o}){let s=(0,W.useRef)(null),c=(0,W.useMemo)(()=>{let e=r?.top,o=e?i.get(e):void 0,s=t.role===`lantern`?new S(`#b86b22`):new S(`#000000`);return new y({color:e?`#ffffff`:t.role===`metal`?`#242a2c`:Yt(n),map:o,roughness:t.role===`metal`?.45:.88,metalness:t.role===`metal`?.5:0,transparent:a||/glass|pane|leaves/.test(n),opacity:a?.2:1,alphaTest:/glass|pane|leaves|door|trapdoor/.test(n)?.08:0,emissive:s,emissiveIntensity:t.role===`lantern`?1.1:0})},[n,a,t.role,i,r?.top]);return(0,W.useEffect)(()=>()=>{c.dispose()},[c]),(0,W.useEffect)(()=>{if(!s.current)return;let n=new se,r=new g().setFromEuler(new _e(0,t.rotationY??0,0));e.forEach((e,i)=>{n.compose(new w(e.x+t.offset[0],e.y+t.offset[1],e.z+t.offset[2]),r,new w(...t.size)),s.current.setMatrixAt(i,n)}),s.current.instanceMatrix.needsUpdate=!0},[e,t]),(0,Z.jsx)(`instancedMesh`,{ref:s,args:[void 0,void 0,e.length],material:c,frustumCulled:!0,onClick:t=>{t.stopPropagation(),t.instanceId!==void 0&&o(e[t.instanceId])},children:(0,Z.jsx)(`boxGeometry`,{args:[1,1,1]})})}function on({selection:e,color:t=`#f2b661`}){if(!e)return null;let n=[e.max.x-e.min.x+1.08,e.max.y-e.min.y+1.08,e.max.z-e.min.z+1.08],r=[(e.min.x+e.max.x)/2,(e.min.y+e.max.y)/2,(e.min.z+e.max.z)/2];return(0,Z.jsxs)(Ze,{args:n,position:r,children:[(0,Z.jsx)(`meshBasicMaterial`,{transparent:!0,opacity:.035,color:t,depthWrite:!1}),(0,Z.jsx)(Ye,{color:t})]})}function sn({build:e,maxLayer:t,hideRoof:n,cameraPreset:r,cameraTarget:i,cameraDistance:a,orthographic:o,selection:s,annotations:c,texturePack:l,mobileRendering:u,onPick:d}){let f=rn(l),p=(0,W.useMemo)(()=>{let r=new Map;for(let i of e.placements){if(i.y>t||n&&Dt(i,e))continue;let a=je(i.block,i.state),o=r.get(a)??{placement:i,placements:[],parts:Xt(i,e.input.edition)};o.placements.push(i),r.set(a,o)}return[...r.entries()]},[e,n,t]),m=[(e.bounds.min.x+e.bounds.max.x)/2,(e.bounds.min.y+e.bounds.max.y)/2,(e.bounds.min.z+e.bounds.max.z)/2],h=i?[i.x,i.y,i.z]:m,g=Math.max(e.bounds.dimensions.width,e.bounds.dimensions.depth,e.bounds.dimensions.height)*1.35,_=Math.max(6,Math.min(g,a??g)),v=`${r}-${Q({x:h[0],y:h[1],z:h[2]})}-${_.toFixed(2)}`,y={iso:[h[0]+_,h[1]+_*.65,h[2]-_],top:[h[0],h[1]+_*1.6,h[2]+.01],north:[h[0],h[1]+_*.3,h[2]-_*1.3],south:[h[0],h[1]+_*.3,h[2]+_*1.3],east:[h[0]+_*1.3,h[1]+_*.3,h[2]],west:[h[0]-_*1.3,h[1]+_*.3,h[2]]};return(0,Z.jsxs)(ge,{frameloop:`demand`,shadows:!u,dpr:u?1:[1,1.5],gl:{antialias:!u,alpha:!1,powerPreference:u?`low-power`:`high-performance`},onPointerMissed:()=>void 0,children:[(0,Z.jsx)(`color`,{attach:`background`,args:[`#06141e`]}),o?(0,Z.jsx)(k,{makeDefault:!0,position:y[r],zoom:Math.max(4,850/_),onUpdate:e=>e.lookAt(...h)},`review-ortho-${v}`):(0,Z.jsx)(ae,{makeDefault:!0,position:y[r],fov:42,onUpdate:e=>e.lookAt(...h)},`review-perspective-${v}`),(0,Z.jsx)(`ambientLight`,{intensity:1.05,color:`#a8bfd0`}),(0,Z.jsx)(`directionalLight`,{position:[h[0]+_,h[1]+_,h[2]-_],intensity:2.2,color:`#f5e7cf`,castShadow:!u}),p.flatMap(([e,t])=>t.parts.map((n,r)=>(0,Z.jsx)(an,{placements:t.placements,part:n,block:t.placement.block,textures:l?.textures.get(e),textureMaps:f,dimmed:!1,onPick:d},`${e}-${r}`))),(0,Z.jsx)(on,{selection:s}),c.map(e=>(0,Z.jsx)(on,{selection:e.bounds,color:e.resolved?`#536b76`:Zt[e.category]},e.id)),(0,Z.jsx)(de,{position:[m[0],e.bounds.min.y-.51,m[2]],args:[Math.max(64,g*2),Math.max(64,g*2)],cellSize:1,cellColor:`#294554`,sectionSize:5,sectionColor:`#3f6170`,fadeDistance:g*1.8,infiniteGrid:!0}),(0,Z.jsx)(j,{makeDefault:!0,target:h,minDistance:2,maxDistance:g*4,maxPolarAngle:Math.PI/2.01,enabled:!0})]})}function cn(e,t){return{min:{x:Math.min(e.x,t.x),y:Math.min(e.y,t.y),z:Math.min(e.z,t.z)},max:{x:Math.max(e.x,t.x),y:Math.max(e.y,t.y),z:Math.max(e.z,t.z)}}}function $({label:e,shortcut:t,active:n,disabled:r,onClick:i,children:a}){let o=t?`${e} (${t})`:e;return(0,Z.jsx)(`button`,{type:`button`,className:`review-icon-button ${n?`active`:``}`,"aria-label":o,"aria-pressed":n===void 0?void 0:n,title:o,disabled:r,onClick:i,children:a})}function ln(e){return{reviewBuildId:e?.id,reviewBuildHash:e?.hash,mode:`orbit`,layer:e?.bounds.max.y??0,hideRoof:!1,orthographic:!1,cameraPreset:`iso`,cameraTarget:void 0,cameraDistance:void 0,annotations:[],selection:void 0,anchor:void 0,searchQuery:``,searchCursor:-1,auditQuery:``,auditSeverity:`all`,annotationQuery:``,annotationCategory:`all`,annotationStatus:`all`,focusedFindingCode:void 0,focusedFindingIndex:void 0}}function un(){let{output:e,isPending:t,responseMetadata:n}=a(),[r,i]=xe(),{maxHeight:s}=Ce(),{download:c}=Ee(),l=Oe(),u=Qt(),d=n,[f,p]=(0,W.useState)(!1),[m,h]=(0,W.useState)(!1),g=jt(f,r),_=me(d?.buildSummary,d?.buildPage,d?.build,{enabled:g}),v=g?_.build:void 0,y=d?.audit,b=e?.review,x=(v??d?.buildSummary)?.bounds.max.y??0,ee=(v??d?.buildSummary)?.bounds.min.y??0,[S,C]=Se(ln(v)),w=(v?Ct(S,v):`unbound`)===`current`?S:ln(v),T=w.mode??`orbit`,E=w.layer??x,D=w.hideRoof??!1,O=w.orthographic??!1,k=w.cameraPreset??`iso`,ae=w.cameraTarget,se=w.cameraDistance,A=Array.isArray(w.annotations)?w.annotations:[],j=w.selection,de=w.anchor,ge=w.searchQuery??``,_e=w.auditQuery??``,ve=w.auditSeverity??`all`,ye=w.annotationQuery??``,be=w.annotationCategory??`all`,je=w.annotationStatus??`all`,[Pe,Fe]=(0,W.useState)(`fix`),[Ie,M]=(0,W.useState)(``),[N,P]=(0,W.useState)(),[Le,Re]=(0,W.useState)(),[F,I]=(0,W.useState)(),[L,R]=(0,W.useState)(!1),[z,ze]=(0,W.useState)(null),[Be,B]=(0,W.useState)(`Procedural fallback`),Ve=(0,W.useRef)(null),He=(0,W.useRef)(null),Ue=(0,W.useRef)(null),V=(0,W.useRef)(globalThis.crypto?.randomUUID?.()??`${Date.now().toString(36)}_${Math.random().toString(36).slice(2,12)}`),H=v?`${v.id}:${v.hash}`:``,U=(0,W.useRef)(H);U.current=H;let We=(0,W.useMemo)(()=>{let e=new Map;for(let t of v?.placements??[])e.set(Q(t),t);return e},[v]),Ge=(0,W.useMemo)(()=>v?.placements.reduce((e,t)=>e+ +(t.y<=E&&(!D||!Dt(t,v))),0)??0,[v,D,E]),Ke=(0,W.useMemo)(()=>!v||xt(ge)?{matches:[],capped:!1,tooShort:!1}:St(v.placements,ge),[v,ge]),qe=Ke.matches,Je=(0,W.useMemo)(()=>{if(!y)return[];let e=_e.trim().toLowerCase();return y.findings.filter(t=>(ve===`all`||t.severity===ve)&&(!e||`${t.code.replaceAll(`_`,` `)} ${t.message} ${t.coordinates.map(Q).join(` `)}`.toLowerCase().includes(e)))},[y,_e,ve]),G=(0,W.useMemo)(()=>Je.flatMap(e=>e.coordinates.map((t,n)=>({finding:e,coordinate:t,coordinateIndex:n}))),[Je]),Ye=(0,W.useMemo)(()=>{let e=ye.trim().toLowerCase();return A.filter(t=>(be===`all`||t.category===be)&&(je===`all`||je===`resolved`==!!t.resolved)&&(!e||`${t.category} ${t.note} ${t.pickedBlock??``} ${Q(t.bounds.min)} ${Q(t.bounds.max)}`.toLowerCase().includes(e)))},[be,ye,je,A]);(0,W.useEffect)(()=>{if(!v)return;let e=Ct(S,v);if(e===`different`){C(ln(v)),Fe(`fix`),M(``),P(void 0),Re(void 0),R(!1),ze(null),B(`Procedural fallback`),I({kind:`info`,message:`Build changed; previous build-bound review state was cleared.`});return}if(e===`unbound`){let e=[],t=Array.isArray(S.annotations)?S.annotations:[];try{e=Et({schemaVersion:1,type:`blockwright-review`,build:{id:v.id,hash:v.hash},annotations:t},v)}catch{}C({...ln(v),annotations:e}),t.length&&!e.length&&I({kind:`info`,message:`Older saved annotations could not be verified for this build and were cleared.`});return}let t=Array.isArray(S.annotations)?S.annotations:[],n=t.length>500?t.slice(0,500):t,r=typeof S.layer==`number`&&S.layer>=v.bounds.min.y&&S.layer<=v.bounds.max.y?S.layer:v.bounds.max.y;(n!==S.annotations||r!==S.layer)&&(C(e=>({...e,layer:r,annotations:n})),t.length>500&&I({kind:`info`,message:`Saved review state was repaired to the 500-annotation limit.`}))},[v?.hash,v?.id,S.annotations?.length,S.reviewBuildHash,S.reviewBuildId]),(0,W.useEffect)(()=>()=>z?.dispose(),[z]);let Xe=()=>{p(!1),h(!1),R(!1),ze(null),B(`Procedural fallback`)},Ze=async()=>{if(!m){h(!0),p(!0),I(void 0);try{if((await i(`fullscreen`)).mode!==`fullscreen`){p(!1),I({kind:`error`,message:`This host did not open a fullscreen review. The low-resource summary remains active.`});return}}catch(e){p(!1),I({kind:`error`,message:e instanceof Error?e.message:`The 3D reviewer could not be opened.`})}finally{h(!1)}}},K=()=>{Xe(),i(`inline`).catch(e=>I({kind:`error`,message:e instanceof Error?e.message:`The viewer was stopped, but the host could not collapse this card.`}))},mt=()=>{Xe(),i(`inline`).catch(()=>void 0),l().catch(e=>I({kind:`error`,message:e instanceof Error?`3D stopped. ${e.message}`:`3D stopped, but the host could not close this card.`}))};(0,W.useEffect)(()=>{!m&&f&&r!==`fullscreen`&&Xe()},[r,f,m]),(0,W.useEffect)(()=>{if(!g||typeof window>`u`)return;let e=V.current,t=!1,n=()=>{t||(t=!0,Xe(),I({kind:`info`,message:`3D stopped because another Blockwright reviewer became active. Only one live 3D viewer is kept at a time.`}),i(`inline`).catch(()=>void 0))},r=t=>{Nt(t,e)&&n()},a;try{a=new BroadcastChannel(Ot),a.addEventListener(`message`,e=>r(e.data))}catch{}let o=e=>{if(e.key===`blockwright:reviewer:3d-lease:v1`&&e.newValue)try{r(JSON.parse(e.newValue))}catch{}};window.addEventListener(`storage`,o);let s=Mt(e);try{a?.postMessage(s)}catch{}try{window.localStorage.setItem(kt,JSON.stringify(s))}catch{}return()=>{a?.close(),window.removeEventListener(`storage`,o)}},[g]),(0,W.useEffect)(()=>{if(!g)return;let e=e=>{let t=e.target?.matches(`input, textarea, select, [contenteditable='true']`);if(e.key===`Escape`){L?R(!1):(P(void 0),M(``),C(e=>({...e,anchor:void 0,selection:void 0})));return}if(t)return;let n=e.key.toLowerCase(),r={o:`orbit`,b:`select`,r:`region`,m:`measure`},i={1:`iso`,2:`top`,3:`north`,4:`south`,5:`east`,6:`west`};r[n]?(e.preventDefault(),C(e=>({...e,mode:r[n],anchor:void 0}))):i[n]?(e.preventDefault(),C(e=>({...e,cameraPreset:i[n]}))):n===`0`?(e.preventDefault(),C(e=>({...e,cameraTarget:void 0,cameraDistance:void 0}))):n===`p`?(e.preventDefault(),C(e=>({...e,orthographic:!e.orthographic}))):n===`h`?(e.preventDefault(),C(e=>({...e,hideRoof:!e.hideRoof}))):e.key===`[`?(e.preventDefault(),C(e=>({...e,layer:Math.max(ee,(e.layer??x)-1)}))):e.key===`]`?(e.preventDefault(),C(e=>({...e,layer:Math.min(x,(e.layer??x)+1)}))):e.key===`?`||e.key===`/`&&e.shiftKey?(e.preventDefault(),R(e=>!e)):e.key===`/`&&(e.preventDefault(),Ue.current?.focus())};return window.addEventListener(`keydown`,e),()=>window.removeEventListener(`keydown`,e)},[x,ee,g,L]);let q=d?.buildSummary,ht=b?.name??q?.input.name??`Build review`,gt=b?.blockCount??q?.blockCount,_t=b?.audit??y?.totals,J=Pt(q?.materialCounts??{}),Y=q?.bounds.dimensions,wt=q?`Review summary for ${ht}, immutable hash ${q.hash.slice(0,12)}. ${gt?.toLocaleString()??`Unknown`} blocks, ${J.materialCount} exact materials. ${_t?`${_t.errors} audit errors and ${_t.warnings} warnings.`:`Audit pending.`} 3D is not loaded until explicitly opened.`:`Preparing a low-resource Blockwright review summary. 3D is not loaded.`;if(!g)return(0,Z.jsx)(o,{content:wt,children:(0,Z.jsxs)(`section`,{className:`inline-summary review-inline review-inline-summary`,style:{maxHeight:s||void 0},"aria-busy":t,children:[(0,Z.jsx)(`div`,{className:`brand-cube`,children:(0,Z.jsx)(pe,{size:22})}),(0,Z.jsxs)(`div`,{className:`review-inline-copy`,children:[(0,Z.jsxs)(`h2`,{children:[`Review `,ht]}),(0,Z.jsxs)(`p`,{children:[gt===void 0?`Preparing audited build summary…`:`${gt.toLocaleString()} exact blocks`,q?` · ${q.input.edition} ${q.input.version}${Y?` · ${Y.width}×${Y.depth}×${Y.height}`:``}`:``]}),_t&&(0,Z.jsxs)(`div`,{className:`review-inline-facts`,"aria-label":`Audit summary`,children:[(0,Z.jsxs)(`span`,{children:[_t.errors,` errors`]}),(0,Z.jsxs)(`span`,{children:[_t.warnings,` warnings`]}),(0,Z.jsxs)(`span`,{children:[J.materialCount,` materials`]})]}),J.visible.length>0&&(0,Z.jsxs)(`p`,{className:`review-inline-palette`,children:[(0,Z.jsx)(`strong`,{children:`Top materials:`}),` `,J.visible.map(([e,t])=>`${$t(e)} (${t.toLocaleString()})`).join(`, `),J.hiddenCount>0?`, +${J.hiddenCount} more`:``]}),F&&(0,Z.jsx)(`p`,{className:`review-inline-notice ${F.kind}`,role:F.kind===`error`?`alert`:`status`,children:F.message})]}),(0,Z.jsxs)(`div`,{className:`review-inline-actions`,children:[(0,Z.jsxs)(`button`,{className:`primary-button`,disabled:m||t||!q||!b||!y,onClick:()=>void Ze(),children:[(0,Z.jsx)(we,{size:16}),m?`Opening…`:`Open 3D`]}),(0,Z.jsxs)(`button`,{type:`button`,className:`review-close-button`,onClick:mt,"aria-label":`Close viewer`,children:[(0,Z.jsx)(De,{size:16}),(0,Z.jsx)(`span`,{children:`Close`})]})]})]})});if(!t&&d?.buildSummary&&_.error)return(0,Z.jsxs)(`section`,{className:`inline-summary review-inline-summary`,style:{maxHeight:s||void 0},role:`alert`,children:[(0,Z.jsx)(le,{size:34}),(0,Z.jsxs)(`div`,{className:`review-inline-copy`,children:[(0,Z.jsx)(`h2`,{children:`Exact review blocks could not be loaded`}),(0,Z.jsx)(`p`,{children:_.error})]}),(0,Z.jsxs)(`div`,{className:`review-inline-actions`,children:[(0,Z.jsx)(`button`,{type:`button`,onClick:K,children:`Back to summary`}),(0,Z.jsxs)(`button`,{type:`button`,className:`review-close-button`,onClick:mt,"aria-label":`Close viewer`,children:[(0,Z.jsx)(De,{size:16}),(0,Z.jsx)(`span`,{children:`Close`})]})]})]});if(t||!v||!b||!y)return(0,Z.jsxs)(`section`,{className:`inline-summary review-inline-summary`,style:{maxHeight:s||void 0},"aria-busy":`true`,children:[(0,Z.jsx)(ie,{size:34}),(0,Z.jsxs)(`div`,{className:`review-inline-copy`,children:[(0,Z.jsx)(`h2`,{children:`Loading exact review blocks`}),(0,Z.jsx)(`p`,{children:d?.buildSummary?`${_.loaded.toLocaleString()} / ${_.total.toLocaleString()}`:`Preparing exact 3D review…`})]}),(0,Z.jsxs)(`div`,{className:`review-inline-actions`,children:[(0,Z.jsx)(`button`,{type:`button`,onClick:K,children:`Cancel 3D`}),(0,Z.jsxs)(`button`,{type:`button`,className:`review-close-button`,onClick:mt,"aria-label":`Close viewer`,children:[(0,Z.jsx)(De,{size:16}),(0,Z.jsx)(`span`,{children:`Close`})]})]})]});let At=e=>{let t={x:e.x,y:e.y,z:e.z};return{...cn(t,t),type:`block`,blockCount:1,pickedBlock:e.block,pickedState:e.state,pickedPhase:e.phase}},Ft=e=>{let t=yt(e,0);C(n=>({...n,cameraTarget:nn(e),cameraDistance:Math.max(6,Math.max(t.width,t.height,t.depth)*2.1),layer:Math.max(ee,Math.min(x,e.max.y))}))},It=(e,t)=>{let n={x:e.x,y:e.y,z:e.z};C(r=>({...r,mode:`select`,selection:At(e),anchor:void 0,layer:n.y,hideRoof:!Dt(e,v)&&r.hideRoof,cameraTarget:n,cameraDistance:8,focusedFindingCode:t?.code,focusedFindingIndex:t?.coordinateIndex}))},Lt=e=>{let t=We.get(Q(e.coordinate));if(!t){I({kind:`error`,message:`Audit coordinate ${Q(e.coordinate)} is not present in the immutable build.`});return}It(t,{code:e.finding.code,coordinateIndex:e.coordinateIndex}),I({kind:`info`,message:`${e.finding.code.replaceAll(`_`,` `)} · sample ${e.coordinateIndex+1} of ${e.finding.coordinates.length}`})},Rt=e=>{if(!G.length)return;let t=G.findIndex(e=>e.finding.code===w.focusedFindingCode&&e.coordinateIndex===w.focusedFindingIndex),n=t<0?e>0?0:G.length-1:(t+e+G.length)%G.length;Lt(G[n])},zt=e=>{let t={x:e.x,y:e.y,z:e.z};if(T===`orbit`)return;if(T===`select`){C(t=>({...t,selection:At(e),anchor:void 0}));return}if(!de){C(e=>({...e,anchor:t,selection:void 0}));return}let n=cn(de,t);C(t=>({...t,anchor:void 0,selection:{...n,type:T===`measure`?`measure`:`region`,blockCount:vt(v,n),pickedBlock:e.block,pickedState:e.state,pickedPhase:e.phase}}))},Bt=()=>{let e=Ie.trim();if(!j||j.type===`measure`||!e)return;if(!N&&A.length>=500){I({kind:`error`,message:`This review already has the maximum 500 annotations. Resolve, edit, or remove an existing note before adding another.`});return}let t=new Date().toISOString();if(N){if(!A.some(e=>e.id===N)){P(void 0),I({kind:`error`,message:`That annotation is no longer present; no changes were saved.`});return}C(n=>({...n,annotations:n.annotations.map(n=>n.id===N?{...n,category:Pe,note:e,bounds:{min:j.min,max:j.max},blockCount:j.blockCount,pickedBlock:j.pickedBlock,pickedState:j.pickedState,updatedAt:t}:n),selection:void 0})),I({kind:`success`,message:`Annotation updated.`}),P(void 0),M(``);return}let n=globalThis.crypto?.randomUUID?.()??`${Date.now().toString(36)}_${Math.random().toString(36).slice(2,12)}`,r={category:Pe,note:e,bounds:{min:j.min,max:j.max},blockCount:j.blockCount,pickedBlock:j.pickedBlock,pickedState:j.pickedState,createdAt:t};C(e=>{let t=Tt(Array.isArray(e.annotations)?e.annotations:[],r,n);return t?{...e,annotations:t,selection:void 0}:e}),M(``),I({kind:`success`,message:`Annotation saved to exact coordinates.`})},X=e=>{Fe(e.category),M(e.note),P(e.id);let t=v.placements.find(t=>t.x>=e.bounds.min.x&&t.x<=e.bounds.max.x&&t.y>=e.bounds.min.y&&t.y<=e.bounds.max.y&&t.z>=e.bounds.min.z&&t.z<=e.bounds.max.z&&(!e.pickedBlock||t.block===e.pickedBlock));C(n=>({...n,selection:{...e.bounds,type:e.bounds.min.x===e.bounds.max.x&&e.bounds.min.y===e.bounds.max.y&&e.bounds.min.z===e.bounds.max.z?`block`:`region`,blockCount:e.blockCount,pickedBlock:e.pickedBlock,pickedState:e.pickedState,pickedPhase:t?.phase},anchor:void 0})),Ft(e.bounds),I({kind:`info`,message:`Editing annotation; save to apply changes.`})},Vt=e=>{let t=A.findIndex(t=>t.id===e.id);Re({annotation:e,index:Math.max(0,t)}),C(t=>({...t,annotations:t.annotations.filter(t=>t.id!==e.id)})),N===e.id&&(P(void 0),M(``)),I({kind:`info`,message:`Annotation removed. Undo is available.`})},Ht=()=>{Le&&(C(e=>{if(e.annotations.some(e=>e.id===Le.annotation.id)||e.annotations.length>=500)return e;let t=[...e.annotations];return t.splice(Math.min(Le.index,t.length),0,Le.annotation),{...e,annotations:t}}),Re(void 0),I({kind:`success`,message:`Annotation restored.`}))},Ut=e=>{let t=!e.resolved;C(n=>({...n,annotations:n.annotations.map(n=>n.id===e.id?{...n,resolved:t,updatedAt:new Date().toISOString()}:n)})),I({kind:`success`,message:t?`Annotation marked resolved.`:`Annotation reopened.`})},Wt=async()=>{let e=H,t=v.input.name.toLowerCase().replace(/[^a-z0-9]+/g,`-`).replace(/^-|-$/g,``)||`blockwright-build`,n={schemaVersion:1,type:`blockwright-review`,build:{id:v.id,hash:v.hash,name:v.input.name,edition:v.input.edition,version:v.input.version,bounds:v.bounds},annotations:A,audit:y,viewer:{mode:T,layer:E,hideRoof:D,orthographic:O,cameraPreset:k,cameraTarget:ae,cameraDistance:se},exportedAt:new Date().toISOString()};try{Et(n,v);let r=JSON.stringify(n,null,2);if(new TextEncoder().encode(r).byteLength>1e6)throw Error(`This review exceeds the ${Math.round(ft/1e3)} KB import limit. Shorten or remove annotations before exporting.`);if(U.current!==e)throw Error(`The build changed before export completed. Export the newly opened review instead.`);let i=await c({contents:[{type:`resource`,resource:{uri:`file:///${t}-review.json`,mimeType:`application/json`,text:r}}]});if(U.current!==e)return;I(i.isError?{kind:`info`,message:`Review export was canceled or unavailable.`}:{kind:`success`,message:`Exported ${A.length} annotations for build ${v.hash.slice(0,12)}.`})}catch(e){I({kind:`error`,message:e instanceof Error?e.message:`Could not export this review.`})}},Gt=async e=>{if(!e)return;let t=H;try{if(e.size>1e6)throw Error(`Review files must be ${Math.round(ft/1e3)} KB or smaller.`);if(!e.name.toLowerCase().endsWith(`.json`))throw Error(`Choose a Blockwright review JSON file.`);let n=await e.text();if(U.current!==t)throw Error(`The build changed while the review file was being read. Choose the file again for the current build.`);let r=Et(JSON.parse(n),v);C(e=>Ct(e,v)===`current`?{...e,annotations:r}:e),P(void 0),Re(void 0),M(``),I({kind:`success`,message:`Imported ${r.length} validated annotation${r.length===1?``:`s`}; build hash matched.`})}catch(e){I({kind:`error`,message:e instanceof Error?e.message:`Could not import this review.`})}},Kt=async e=>{if(!e)return;let t=H;B(`Reading ${e.name}…`);try{let n=await Ne(e,v.placements);if(U.current!==t){n.dispose();return}ze(e=>(e?.dispose(),n)),B(`${n.name} · ${n.resolved}/${n.requested} states resolved`),I({kind:`success`,message:`${n.resolved} of ${n.requested} material states resolved from ${n.name}.`})}catch(e){B(e instanceof Error?e.message:`Could not read this resource pack.`),I({kind:`error`,message:e instanceof Error?e.message:`Could not read this resource pack.`})}},qt=()=>{let e=xt(ge);if(e){let t=We.get(Q(e));if(!t){I({kind:`error`,message:`No canonical block exists at ${Q(e)}.`});return}It(t),I({kind:`success`,message:`Focused ${t.block} at ${Q(t)}.`});return}if(!qe.length){let e=ge.trim();I({kind:`error`,message:Ke.tooShort?`Use at least 2 characters for block, phase, or state search; exact coordinates are always accepted.`:e?`No block, phase, or state matches “${e}”.`:`Enter coordinates, a block, phase, or state.`});return}let t=((w.searchCursor??-1)+1)%qe.length,n=qe[t];It(n),C(e=>({...e,searchCursor:t})),I({kind:`success`,message:`Match ${t+1} of ${qe.length}${Ke.capped?`+ capped results`:``}: ${n.block} at ${Q(n)}.`})},Jt=async(e,t)=>{try{if(!navigator.clipboard?.writeText)throw Error(`Clipboard access is unavailable in this host.`);await navigator.clipboard.writeText(e),I({kind:`success`,message:`${t} copied.`})}catch(e){I({kind:`error`,message:e instanceof Error?e.message:`Could not copy to the clipboard.`})}},Yt=j?yt(j,j.blockCount):void 0,Xt=j?.type===`measure`?bt(j):void 0,rn=j?.pickedState?en(j.pickedState):``,an=Math.max(ee,Math.min(E,x)),on=A.filter(e=>!e.resolved).length,un=y.findings.find(e=>e.code===w.focusedFindingCode),dn=`Reviewing ${v.input.name}, immutable hash ${v.hash.slice(0,12)}. ${Ge} of ${v.placements.length} blocks visible through Y ${an}; ${D?`roof hidden`:`roof visible`}. Camera ${k} ${O?`orthographic`:`perspective`}${ae?` focused at ${Q(ae)}`:` framed on the full build`}. ${A.length} annotations: ${on} open and ${A.length-on} resolved. ${j?`Selected ${j.type} from ${Q(j.min)} to ${Q(j.max)}${j.pickedBlock?`; canonical block ${j.pickedBlock}${rn?` with state ${rn}`:``}`:``}.`:`No selection.`} ${un?`Current audit finding ${un.code}, sample ${(w.focusedFindingIndex??0)+1}.`:``} Global audit: ${y.totals.errors} errors and ${y.totals.warnings} warnings across ${y.scannedPlacements} placements.`;return(0,Z.jsx)(o,{content:dn,children:(0,Z.jsxs)(`main`,{className:`review-shell`,style:{maxHeight:s||void 0},children:[(0,Z.jsxs)(`header`,{className:`review-header`,children:[(0,Z.jsxs)(`div`,{children:[(0,Z.jsx)(`span`,{className:`panel-kicker`,children:`Blockwright reviewer`}),(0,Z.jsx)(`h1`,{children:v.input.name})]}),(0,Z.jsxs)(`div`,{className:`review-header-actions`,children:[(0,Z.jsxs)(`button`,{onClick:()=>He.current?.click(),children:[(0,Z.jsx)(Me,{size:15}),`Textures`]}),(0,Z.jsxs)(`button`,{onClick:()=>Ve.current?.click(),children:[(0,Z.jsx)(nt,{size:15}),`Import review`]}),(0,Z.jsxs)(`button`,{className:`primary-button`,onClick:()=>void Wt(),children:[(0,Z.jsx)(Te,{size:15}),`Export review`]}),(0,Z.jsx)($,{label:`Collapse reviewer`,onClick:K,children:(0,Z.jsx)(we,{size:16})}),(0,Z.jsxs)(`button`,{type:`button`,className:`review-close-button`,onClick:mt,"aria-label":`Close viewer`,children:[(0,Z.jsx)(De,{size:16}),(0,Z.jsx)(`span`,{children:`Close`})]})]}),(0,Z.jsx)(`input`,{ref:He,hidden:!0,type:`file`,accept:`.zip,.jar,application/zip,application/java-archive`,onChange:e=>void Kt(e.target.files?.[0])}),(0,Z.jsx)(`input`,{ref:Ve,hidden:!0,type:`file`,accept:`.json,application/json`,onChange:e=>{let t=e.currentTarget.files?.[0];e.currentTarget.value=``,Gt(t)}})]}),(0,Z.jsxs)(`aside`,{className:`review-tools`,"aria-label":`Review tools`,children:[(0,Z.jsx)($,{label:`Orbit`,shortcut:`O`,active:T===`orbit`,onClick:()=>C(e=>({...e,mode:`orbit`,anchor:void 0})),children:(0,Z.jsx)(at,{size:19})}),(0,Z.jsx)($,{label:`Select block`,shortcut:`B`,active:T===`select`,onClick:()=>C(e=>({...e,mode:`select`,anchor:void 0})),children:(0,Z.jsx)(te,{size:19})}),(0,Z.jsx)($,{label:`Select region`,shortcut:`R`,active:T===`region`,onClick:()=>C(e=>({...e,mode:`region`,anchor:void 0})),children:(0,Z.jsx)(fe,{size:19})}),(0,Z.jsx)($,{label:`Measure`,shortcut:`M`,active:T===`measure`,onClick:()=>C(e=>({...e,mode:`measure`,anchor:void 0})),children:(0,Z.jsx)(oe,{size:19})}),(0,Z.jsx)($,{label:`Frame whole build`,shortcut:`0`,active:!ae,onClick:()=>C(e=>({...e,cameraTarget:void 0,cameraDistance:void 0})),children:(0,Z.jsx)(rt,{size:19})}),(0,Z.jsx)(`span`,{className:`review-tools-spacer`}),(0,Z.jsx)($,{label:`Isometric view`,shortcut:`1`,active:k===`iso`,onClick:()=>C(e=>({...e,cameraPreset:`iso`})),children:(0,Z.jsx)(tt,{size:19})}),(0,Z.jsx)($,{label:`Top view`,shortcut:`2`,active:k===`top`,onClick:()=>C(e=>({...e,cameraPreset:`top`})),children:(0,Z.jsx)(ne,{size:19})}),(0,Z.jsx)($,{label:`North view`,shortcut:`3`,active:k===`north`,onClick:()=>C(e=>({...e,cameraPreset:`north`})),children:(0,Z.jsx)(re,{size:19})}),(0,Z.jsx)($,{label:`South view`,shortcut:`4`,active:k===`south`,onClick:()=>C(e=>({...e,cameraPreset:`south`})),children:(0,Z.jsx)(ne,{size:19})}),(0,Z.jsx)($,{label:`East view`,shortcut:`5`,active:k===`east`,onClick:()=>C(e=>({...e,cameraPreset:`east`})),children:(0,Z.jsx)(ce,{size:19})}),(0,Z.jsx)($,{label:`West view`,shortcut:`6`,active:k===`west`,onClick:()=>C(e=>({...e,cameraPreset:`west`})),children:(0,Z.jsx)(he,{size:19})}),(0,Z.jsx)($,{label:`Keyboard shortcuts`,shortcut:`?`,active:L,onClick:()=>R(e=>!e),children:(0,Z.jsx)(Qe,{size:19})})]}),(0,Z.jsxs)(`section`,{className:`review-viewport`,children:[(0,Z.jsx)(sn,{build:v,maxLayer:an,hideRoof:D,cameraPreset:k,cameraTarget:ae,cameraDistance:se,orthographic:O,selection:j,annotations:A,texturePack:z,mobileRendering:u,onPick:zt}),(0,Z.jsxs)(`form`,{className:`review-search`,role:`search`,onSubmit:e=>{e.preventDefault(),qt()},children:[(0,Z.jsx)(ct,{size:14,"aria-hidden":`true`}),(0,Z.jsx)(`input`,{ref:Ue,"aria-label":`Find exact coordinates, block, phase, or state`,value:ge,onChange:e=>C(t=>({...t,searchQuery:e.target.value,searchCursor:-1})),placeholder:`x,y,z or block / phase / state`}),ge&&(0,Z.jsx)(`button`,{type:`button`,"aria-label":`Clear search`,onClick:()=>C(e=>({...e,searchQuery:``,searchCursor:-1})),children:(0,Z.jsx)(De,{size:13})}),(0,Z.jsxs)(`button`,{type:`submit`,children:[`Find`,qe.length?` · ${qe.length}${Ke.capped?`+`:``}`:``]})]}),(0,Z.jsxs)(`div`,{className:`review-view-switch`,"aria-label":`Camera projection`,children:[(0,Z.jsx)(`button`,{type:`button`,"aria-pressed":!O,className:O?``:`active`,onClick:()=>C(e=>({...e,orthographic:!1})),children:`Perspective`}),(0,Z.jsx)(`button`,{type:`button`,"aria-pressed":O,className:O?`active`:``,onClick:()=>C(e=>({...e,orthographic:!0})),children:`Orthographic`})]}),(0,Z.jsxs)(`div`,{className:`review-viewport-status`,children:[(0,Z.jsxs)(`span`,{children:[Ge.toLocaleString(),` / `,v.placements.length.toLocaleString(),` visible`]}),ae&&(0,Z.jsxs)(`span`,{children:[`Focus `,Q(ae)]})]}),(0,Z.jsxs)(`div`,{className:`review-layer-control`,children:[(0,Z.jsx)(ue,{size:15}),(0,Z.jsx)(`input`,{"aria-label":`Maximum visible Y layer ${an}`,type:`range`,min:ee,max:x,value:an,onChange:e=>C(t=>({...t,layer:Number(e.target.value)}))}),(0,Z.jsxs)(`strong`,{children:[`Y ≤ `,an]}),(0,Z.jsxs)(`label`,{children:[(0,Z.jsx)(`input`,{type:`checkbox`,checked:D,onChange:e=>C(t=>({...t,hideRoof:e.target.checked}))}),`Hide roof `,(0,Z.jsx)(`kbd`,{children:`H`})]})]}),de&&(0,Z.jsxs)(`div`,{className:`review-instruction`,role:`status`,children:[`First corner: `,Q(de),` · choose the second point `,(0,Z.jsx)(`button`,{type:`button`,onClick:()=>C(e=>({...e,anchor:void 0})),children:`Cancel`})]}),F&&(0,Z.jsxs)(`div`,{className:`review-activity ${F.kind}`,role:F.kind===`error`?`alert`:`status`,"aria-live":`polite`,children:[F.kind===`error`?(0,Z.jsx)(le,{size:14}):F.kind===`success`?(0,Z.jsx)(ke,{size:14}):(0,Z.jsx)(pe,{size:14}),(0,Z.jsx)(`span`,{children:F.message}),(0,Z.jsx)(`button`,{type:`button`,"aria-label":`Dismiss message`,onClick:()=>I(void 0),children:(0,Z.jsx)(De,{size:13})})]}),L&&(0,Z.jsxs)(`section`,{className:`review-shortcuts`,"aria-label":`Keyboard shortcuts`,children:[(0,Z.jsxs)(`header`,{children:[(0,Z.jsx)(`strong`,{children:`Keyboard shortcuts`}),(0,Z.jsx)(`button`,{type:`button`,"aria-label":`Close keyboard shortcuts`,onClick:()=>R(!1),children:(0,Z.jsx)(De,{size:14})})]}),(0,Z.jsxs)(`dl`,{children:[(0,Z.jsxs)(`div`,{children:[(0,Z.jsxs)(`dt`,{children:[(0,Z.jsx)(`kbd`,{children:`O`}),` `,(0,Z.jsx)(`kbd`,{children:`B`}),` `,(0,Z.jsx)(`kbd`,{children:`R`}),` `,(0,Z.jsx)(`kbd`,{children:`M`})]}),(0,Z.jsx)(`dd`,{children:`Orbit, block, region, measure`})]}),(0,Z.jsxs)(`div`,{children:[(0,Z.jsxs)(`dt`,{children:[(0,Z.jsx)(`kbd`,{children:`1`}),`–`,(0,Z.jsx)(`kbd`,{children:`6`})]}),(0,Z.jsx)(`dd`,{children:`Isometric, top, cardinal views`})]}),(0,Z.jsxs)(`div`,{children:[(0,Z.jsx)(`dt`,{children:(0,Z.jsx)(`kbd`,{children:`0`})}),(0,Z.jsx)(`dd`,{children:`Frame the whole build`})]}),(0,Z.jsxs)(`div`,{children:[(0,Z.jsxs)(`dt`,{children:[(0,Z.jsx)(`kbd`,{children:`P`}),` `,(0,Z.jsx)(`kbd`,{children:`H`})]}),(0,Z.jsx)(`dd`,{children:`Projection and roof visibility`})]}),(0,Z.jsxs)(`div`,{children:[(0,Z.jsxs)(`dt`,{children:[(0,Z.jsx)(`kbd`,{children:`[`}),` `,(0,Z.jsx)(`kbd`,{children:`]`})]}),(0,Z.jsx)(`dd`,{children:`Move the visible Y layer`})]}),(0,Z.jsxs)(`div`,{children:[(0,Z.jsxs)(`dt`,{children:[(0,Z.jsx)(`kbd`,{children:`/`}),` `,(0,Z.jsx)(`kbd`,{children:`?`})]}),(0,Z.jsx)(`dd`,{children:`Search and shortcut help`})]}),(0,Z.jsxs)(`div`,{children:[(0,Z.jsx)(`dt`,{children:(0,Z.jsx)(`kbd`,{children:`Esc`})}),(0,Z.jsx)(`dd`,{children:`Cancel anchor or clear selection`})]}),(0,Z.jsxs)(`div`,{children:[(0,Z.jsxs)(`dt`,{children:[(0,Z.jsx)(`kbd`,{children:`Ctrl`}),`+`,(0,Z.jsx)(`kbd`,{children:`Enter`})]}),(0,Z.jsx)(`dd`,{children:`Save the annotation draft`})]})]})]})]}),(0,Z.jsxs)(`aside`,{className:`review-inspector`,"aria-label":`Build review inspector`,children:[(0,Z.jsxs)(`section`,{children:[(0,Z.jsxs)(`div`,{className:`review-section-heading`,children:[(0,Z.jsx)(`span`,{className:`panel-kicker`,children:N?`Edit annotation`:`New annotation`}),N?(0,Z.jsx)(`button`,{type:`button`,className:`review-text-button`,onClick:()=>{P(void 0),M(``)},children:`Cancel edit`}):(0,Z.jsx)(`small`,{children:`exact world coordinates`})]}),(0,Z.jsx)(`div`,{className:`review-category-row`,children:dt.map(e=>(0,Z.jsx)(`button`,{type:`button`,"aria-pressed":Pe===e,className:Pe===e?`active`:``,style:{"--category":Zt[e]},onClick:()=>Fe(e),children:e},e))}),(0,Z.jsxs)(`label`,{className:`review-field-label`,htmlFor:`review-annotation-note`,children:[`Actionable intent `,(0,Z.jsxs)(`span`,{children:[Ie.length,`/`,pt]})]}),(0,Z.jsx)(`textarea`,{id:`review-annotation-note`,maxLength:pt,value:Ie,onChange:e=>M(e.target.value),onKeyDown:e=>{e.key===`Enter`&&(e.ctrlKey||e.metaKey)&&(e.preventDefault(),Bt())},placeholder:`Describe the issue, intended rule, or detail to preserve…`}),(0,Z.jsxs)(`button`,{type:`button`,className:`primary-button review-save`,disabled:!j||j.type===`measure`||!Ie.trim()||!N&&A.length>=500,onClick:Bt,children:[(0,Z.jsx)(Ae,{size:15}),N?`Update annotation`:`Save annotation`]}),!N&&A.length>=500&&(0,Z.jsxs)(`small`,{className:`review-help-text`,children:[`Annotation limit reached (`,500,`/`,500,`). Existing notes can still be edited or resolved.`]}),!j&&(0,Z.jsx)(`small`,{className:`review-help-text`,children:`Select a block or region first. Measurements stay separate from annotations.`})]}),(0,Z.jsxs)(`section`,{children:[(0,Z.jsxs)(`div`,{className:`review-section-heading`,children:[(0,Z.jsx)(`span`,{className:`panel-kicker`,children:`Selection`}),(0,Z.jsx)(`small`,{children:j?.type??`none`})]}),j?(0,Z.jsxs)(`div`,{className:`review-selection-card`,children:[(0,Z.jsxs)(`div`,{className:`review-selection-title`,children:[(0,Z.jsxs)(`strong`,{children:[j.blockCount.toLocaleString(),` occupied block`,j.blockCount===1?``:`s`]}),(0,Z.jsx)(`button`,{type:`button`,title:`Frame selection`,"aria-label":`Frame selection`,onClick:()=>Ft(j),children:(0,Z.jsx)(it,{size:14})})]}),(0,Z.jsxs)(`span`,{children:[`Min `,(0,Z.jsx)(`code`,{children:Q(j.min)})]}),(0,Z.jsxs)(`span`,{children:[`Max `,(0,Z.jsx)(`code`,{children:Q(j.max)})]}),Yt&&(0,Z.jsxs)(`span`,{children:[`Inclusive size `,(0,Z.jsxs)(`b`,{children:[Yt.width,` × `,Yt.height,` × `,Yt.depth]}),` · volume `,Yt.volume.toLocaleString()]}),Yt&&j.type!==`block`&&(0,Z.jsxs)(`span`,{children:[`Occupancy `,(Yt.density*100).toFixed(1),`%`]}),j.pickedBlock&&(0,Z.jsxs)(`span`,{className:`review-canonical`,children:[(0,Z.jsx)(`b`,{children:$t(j.pickedBlock)}),(0,Z.jsx)(`code`,{children:j.pickedBlock})]}),j.pickedPhase&&(0,Z.jsxs)(`span`,{children:[`Phase `,(0,Z.jsx)(`b`,{children:j.pickedPhase})]}),rn&&(0,Z.jsx)(`code`,{children:rn}),Xt&&(0,Z.jsxs)(`div`,{className:`review-measurements`,children:[(0,Z.jsxs)(`span`,{children:[`Axis Δ `,(0,Z.jsxs)(`b`,{children:[Xt.dx,`, `,Xt.dy,`, `,Xt.dz]})]}),(0,Z.jsxs)(`span`,{children:[`Horizontal `,(0,Z.jsx)(`b`,{children:Xt.horizontal.toFixed(2)})]}),(0,Z.jsxs)(`span`,{children:[`Direct center-to-center `,(0,Z.jsx)(`b`,{children:Xt.direct.toFixed(2)})]}),(0,Z.jsxs)(`span`,{children:[`Manhattan `,(0,Z.jsx)(`b`,{children:Xt.manhattan})]})]}),(0,Z.jsxs)(`div`,{className:`review-copy-row`,children:[(0,Z.jsxs)(`button`,{type:`button`,onClick:()=>void Jt(Q(j.min),`Minimum coordinates`),children:[(0,Z.jsx)(et,{size:12}),`Copy min`]}),(0,Z.jsxs)(`button`,{type:`button`,onClick:()=>void Jt(`/tp @s ${j.min.x} ${j.min.y} ${j.min.z}`,`Teleport command`),children:[(0,Z.jsx)(et,{size:12}),`Copy /tp`]})]})]}):(0,Z.jsx)(`p`,{className:`review-empty`,children:`Choose block or region select, then click the model.`})]}),(0,Z.jsxs)(`section`,{children:[(0,Z.jsxs)(`div`,{className:`review-section-heading`,children:[(0,Z.jsx)(`span`,{className:`panel-kicker`,children:`Global audit`}),(0,Z.jsxs)(`span`,{className:`review-heading-actions`,children:[(0,Z.jsxs)(`small`,{children:[Je.length,`/`,y.findings.length,` categories`]}),(0,Z.jsx)($,{label:`Previous audit sample`,disabled:!G.length,onClick:()=>Rt(-1),children:(0,Z.jsx)(he,{size:14})}),(0,Z.jsx)($,{label:`Next audit sample`,disabled:!G.length,onClick:()=>Rt(1),children:(0,Z.jsx)(ce,{size:14})})]})]}),(0,Z.jsxs)(`div`,{className:`audit-totals`,children:[(0,Z.jsxs)(`span`,{children:[(0,Z.jsx)(`b`,{children:y.totals.errors}),` errors`]}),(0,Z.jsxs)(`span`,{children:[(0,Z.jsx)(`b`,{children:y.totals.warnings}),` warnings`]}),(0,Z.jsxs)(`span`,{children:[(0,Z.jsx)(`b`,{children:y.statefulPlacements.toLocaleString()}),` stateful`]})]}),(0,Z.jsxs)(`div`,{className:`review-filter-row`,children:[(0,Z.jsx)(ct,{size:13}),(0,Z.jsx)(`input`,{"aria-label":`Filter audit findings`,value:_e,onChange:e=>C(t=>({...t,auditQuery:e.target.value,focusedFindingCode:void 0,focusedFindingIndex:void 0})),placeholder:`Filter code, message, coordinate`}),(0,Z.jsxs)(`select`,{"aria-label":`Audit severity`,value:ve,onChange:e=>C(t=>({...t,auditSeverity:e.target.value,focusedFindingCode:void 0,focusedFindingIndex:void 0})),children:[(0,Z.jsx)(`option`,{value:`all`,children:`All severity`}),(0,Z.jsx)(`option`,{value:`error`,children:`Errors`}),(0,Z.jsx)(`option`,{value:`warning`,children:`Warnings`}),(0,Z.jsx)(`option`,{value:`info`,children:`Info`})]})]}),(0,Z.jsx)(`div`,{className:`audit-findings`,children:Je.length?Je.map(e=>(0,Z.jsxs)(`article`,{className:w.focusedFindingCode===e.code?`active`:``,children:[(0,Z.jsxs)(`button`,{type:`button`,className:`audit-finding-main`,disabled:!e.coordinates.length,onClick:()=>e.coordinates.length&&Lt({finding:e,coordinate:e.coordinates[0],coordinateIndex:0}),children:[(0,Z.jsx)(`span`,{className:`audit-dot ${e.severity}`}),(0,Z.jsxs)(`span`,{children:[(0,Z.jsx)(`strong`,{children:e.code.replaceAll(`_`,` `)}),(0,Z.jsxs)(`small`,{children:[e.total.toLocaleString(),` affected · `,e.coordinates.length.toLocaleString(),` sampled`]}),(0,Z.jsx)(`small`,{children:e.message})]}),e.coordinates.length?(0,Z.jsx)(it,{size:13}):null]}),e.coordinates.length>0&&(0,Z.jsxs)(`div`,{className:`audit-samples`,"aria-label":`${e.code} sampled coordinates`,children:[e.coordinates.slice(0,6).map((t,n)=>(0,Z.jsx)(`button`,{type:`button`,className:w.focusedFindingCode===e.code&&w.focusedFindingIndex===n?`active`:``,onClick:()=>Lt({finding:e,coordinate:t,coordinateIndex:n}),children:Q(t)},Q(t))),e.coordinates.length>6&&(0,Z.jsxs)(`span`,{children:[`+`,e.coordinates.length-6,` more via next`]})]})]},e.code)):y.findings.length?(0,Z.jsx)(`p`,{className:`review-empty`,children:`No audit categories match these filters.`}):(0,Z.jsxs)(`div`,{className:`review-pass`,children:[(0,Z.jsx)(Ae,{size:16}),`No structural audit findings`]})})]}),(0,Z.jsxs)(`section`,{className:`review-history-section`,children:[(0,Z.jsxs)(`div`,{className:`review-section-heading`,children:[(0,Z.jsx)(`span`,{className:`panel-kicker`,children:`Annotation history`}),(0,Z.jsxs)(`span`,{className:`review-heading-actions`,children:[(0,Z.jsxs)(`small`,{children:[on,` open · `,A.length-on,` resolved`]}),Le&&(0,Z.jsxs)(`button`,{type:`button`,className:`review-text-button`,onClick:Ht,children:[(0,Z.jsx)(ut,{size:12}),`Undo`]})]})]}),(0,Z.jsxs)(`div`,{className:`review-filter-row`,children:[(0,Z.jsx)(ct,{size:13}),(0,Z.jsx)(`input`,{"aria-label":`Filter annotations`,value:ye,onChange:e=>C(t=>({...t,annotationQuery:e.target.value})),placeholder:`Filter notes, block, coordinate`}),(0,Z.jsxs)(`select`,{"aria-label":`Annotation category`,value:be,onChange:e=>C(t=>({...t,annotationCategory:e.target.value})),children:[(0,Z.jsx)(`option`,{value:`all`,children:`All categories`}),dt.map(e=>(0,Z.jsx)(`option`,{value:e,children:e},e))]}),(0,Z.jsxs)(`select`,{"aria-label":`Annotation status`,value:je,onChange:e=>C(t=>({...t,annotationStatus:e.target.value})),children:[(0,Z.jsx)(`option`,{value:`all`,children:`All status`}),(0,Z.jsx)(`option`,{value:`open`,children:`Open`}),(0,Z.jsx)(`option`,{value:`resolved`,children:`Resolved`})]})]}),(0,Z.jsx)(`div`,{className:`review-history`,children:Ye.length?Ye.map(e=>(0,Z.jsxs)(`article`,{className:e.resolved?`resolved`:``,children:[(0,Z.jsxs)(`button`,{type:`button`,className:`review-history-focus`,onClick:()=>{let t=e.pickedBlock?v.placements.find(t=>t.block===e.pickedBlock&&t.x>=e.bounds.min.x&&t.x<=e.bounds.max.x&&t.y>=e.bounds.min.y&&t.y<=e.bounds.max.y&&t.z>=e.bounds.min.z&&t.z<=e.bounds.max.z):void 0;C(n=>({...n,selection:{...e.bounds,type:e.bounds.min.x===e.bounds.max.x&&e.bounds.min.y===e.bounds.max.y&&e.bounds.min.z===e.bounds.max.z?`block`:`region`,blockCount:e.blockCount,pickedBlock:e.pickedBlock,pickedState:e.pickedState,pickedPhase:t?.phase},anchor:void 0})),Ft(e.bounds)},children:[(0,Z.jsx)(`i`,{style:{background:Zt[e.category]}}),(0,Z.jsxs)(`span`,{children:[(0,Z.jsxs)(`strong`,{children:[e.resolved?`Resolved · `:``,e.category,` · `,e.blockCount,` block`,e.blockCount===1?``:`s`]}),(0,Z.jsx)(`small`,{children:e.note||Q(e.bounds.min)}),(0,Z.jsxs)(`small`,{children:[Q(e.bounds.min),tn(e.bounds.min,e.bounds.max)?``:` → ${Q(e.bounds.max)}`]})]})]}),(0,Z.jsxs)(`div`,{className:`review-history-actions`,children:[(0,Z.jsx)(`button`,{type:`button`,"aria-label":`Edit annotation ${e.note}`,title:`Edit annotation`,onClick:()=>X(e),children:(0,Z.jsx)(ot,{size:13})}),(0,Z.jsx)(`button`,{type:`button`,"aria-label":e.resolved?`Reopen annotation`:`Mark annotation resolved`,title:e.resolved?`Reopen`:`Mark resolved`,onClick:()=>Ut(e),children:e.resolved?(0,Z.jsx)(st,{size:13}):(0,Z.jsx)($e,{size:13})}),(0,Z.jsx)(`button`,{type:`button`,"aria-label":`Delete annotation ${e.note}`,title:`Delete annotation`,onClick:()=>Vt(e),children:(0,Z.jsx)(lt,{size:13})})]})]},e.id)):A.length?(0,Z.jsx)(`p`,{className:`review-empty`,children:`No annotations match these filters.`}):(0,Z.jsx)(`p`,{className:`review-empty`,children:`No annotations yet.`})})]})]}),(0,Z.jsxs)(`footer`,{className:`review-status`,children:[(0,Z.jsxs)(`span`,{children:[(0,Z.jsx)(`i`,{}),`Ready`]}),(0,Z.jsx)(`span`,{children:T===`orbit`?`Orbit, pan, and zoom`:de?`Choose the second point`:`Review mode: ${T}`}),(0,Z.jsx)(`span`,{children:Be}),(0,Z.jsxs)(`strong`,{children:[Ge.toLocaleString(),` visible · `,on,` open · `,v.hash.slice(0,8)]}),(0,Z.jsx)(pe,{size:16})]})]})})}i((0,W.createElement)(un));