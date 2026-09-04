import{O as e}from"./v4-BJmWi5kg.js";import{a as t,c as n,d as r,i,l as a,n as o,p as s,r as c,s as l,u}from"./helpers-DGW9OV4V.js";import{A as d,B as f,C as p,D as m,E as h,F as g,G as ee,H as _,I as v,L as te,M as y,N as b,O as x,P as S,R as C,S as w,T,U as E,V as ne,W as re,_ as ie,a as ae,b as D,c as oe,d as se,f as ce,g as O,h as k,i as le,j as A,k as j,l as ue,m as de,n as fe,o as pe,p as me,r as he,s as ge,t as _e,u as ve,v as ye,w as M,x as N,y as P,z as F}from"./square-dashed-Cz0EnAId.js";import{i as be,n as I,r as xe,t as Se}from"./resource-pack-DJL1oyVA.js";var L=parseInt(`179`.replace(/\D+/g,``)),Ce=L>=125?`uv1`:`uv2`,we=new D,R=new _,z=class extends T{constructor(){super(),this.isLineSegmentsGeometry=!0,this.type=`LineSegmentsGeometry`,this.setIndex([0,2,1,2,3,1,2,4,3,4,5,3,4,6,5,6,7,5]),this.setAttribute(`position`,new M([-1,2,0,1,2,0,-1,1,0,1,1,0,-1,0,0,1,0,0,-1,-1,0,1,-1,0],3)),this.setAttribute(`uv`,new M([-1,2,1,2,-1,1,1,1,-1,-1,1,-1,-1,-2,1,-2],2))}applyMatrix4(e){let t=this.attributes.instanceStart,n=this.attributes.instanceEnd;return t!==void 0&&(t.applyMatrix4(e),n.applyMatrix4(e),t.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}setPositions(e){let t;e instanceof Float32Array?t=e:Array.isArray(e)&&(t=new Float32Array(e));let n=new h(t,6,1);return this.setAttribute(`instanceStart`,new m(n,3,0)),this.setAttribute(`instanceEnd`,new m(n,3,3)),this.computeBoundingBox(),this.computeBoundingSphere(),this}setColors(e,t=3){let n;e instanceof Float32Array?n=e:Array.isArray(e)&&(n=new Float32Array(e));let r=new h(n,t*2,1);return this.setAttribute(`instanceColorStart`,new m(r,t,0)),this.setAttribute(`instanceColorEnd`,new m(r,t,t)),this}fromWireframeGeometry(e){return this.setPositions(e.attributes.position.array),this}fromEdgesGeometry(e){return this.setPositions(e.attributes.position.array),this}fromMesh(e){return this.fromWireframeGeometry(new re(e.geometry)),this}fromLineSegments(e){let t=e.geometry;return this.setPositions(t.attributes.position.array),this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new D);let e=this.attributes.instanceStart,t=this.attributes.instanceEnd;e!==void 0&&t!==void 0&&(this.boundingBox.setFromBufferAttribute(e),we.setFromBufferAttribute(t),this.boundingBox.union(we))}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new C),this.boundingBox===null&&this.computeBoundingBox();let e=this.attributes.instanceStart,t=this.attributes.instanceEnd;if(e!==void 0&&t!==void 0){let n=this.boundingSphere.center;this.boundingBox.getCenter(n);let r=0;for(let i=0,a=e.count;i<a;i++)R.fromBufferAttribute(e,i),r=Math.max(r,n.distanceToSquared(R)),R.fromBufferAttribute(t,i),r=Math.max(r,n.distanceToSquared(R));this.boundingSphere.radius=Math.sqrt(r),isNaN(this.boundingSphere.radius)&&console.error(`THREE.LineSegmentsGeometry.computeBoundingSphere(): Computed radius is NaN. The instanced position data is likely to have NaN values.`,this)}}toJSON(){}applyMatrix(e){return console.warn(`THREE.LineSegmentsGeometry: applyMatrix() has been renamed to applyMatrix4().`),this.applyMatrix4(e)}},Te=class extends z{constructor(){super(),this.isLineGeometry=!0,this.type=`LineGeometry`}setPositions(e){let t=e.length-3,n=new Float32Array(2*t);for(let r=0;r<t;r+=3)n[2*r]=e[r],n[2*r+1]=e[r+1],n[2*r+2]=e[r+2],n[2*r+3]=e[r+3],n[2*r+4]=e[r+4],n[2*r+5]=e[r+5];return super.setPositions(n),this}setColors(e,t=3){let n=e.length-t,r=new Float32Array(2*n);if(t===3)for(let i=0;i<n;i+=t)r[2*i]=e[i],r[2*i+1]=e[i+1],r[2*i+2]=e[i+2],r[2*i+3]=e[i+3],r[2*i+4]=e[i+4],r[2*i+5]=e[i+5];else for(let i=0;i<n;i+=t)r[2*i]=e[i],r[2*i+1]=e[i+1],r[2*i+2]=e[i+2],r[2*i+3]=e[i+3],r[2*i+4]=e[i+4],r[2*i+5]=e[i+5],r[2*i+6]=e[i+6],r[2*i+7]=e[i+7];return super.setColors(r,t),this}fromLine(e){let t=e.geometry;return this.setPositions(t.attributes.position.array),this}},Ee=class extends te{constructor(e){super({type:`LineMaterial`,uniforms:f.clone(f.merge([P.common,P.fog,{worldUnits:{value:1},linewidth:{value:1},resolution:{value:new ne(1,1)},dashOffset:{value:0},dashScale:{value:1},dashSize:{value:1},gapSize:{value:1}}])),vertexShader:`
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
					#include <${L>=154?`colorspace_fragment`:`encodings_fragment`}>
					#include <fog_fragment>
					#include <premultiplied_alpha_fragment>

				}
			`,clipping:!0}),this.isLineMaterial=!0,this.onBeforeCompile=function(){this.transparent?this.defines.USE_LINE_COLOR_ALPHA=`1`:delete this.defines.USE_LINE_COLOR_ALPHA},Object.defineProperties(this,{color:{enumerable:!0,get:function(){return this.uniforms.diffuse.value},set:function(e){this.uniforms.diffuse.value=e}},worldUnits:{enumerable:!0,get:function(){return`WORLD_UNITS`in this.defines},set:function(e){e===!0?this.defines.WORLD_UNITS=``:delete this.defines.WORLD_UNITS}},linewidth:{enumerable:!0,get:function(){return this.uniforms.linewidth.value},set:function(e){this.uniforms.linewidth.value=e}},dashed:{enumerable:!0,get:function(){return`USE_DASH`in this.defines},set(e){!!e!=`USE_DASH`in this.defines&&(this.needsUpdate=!0),e===!0?this.defines.USE_DASH=``:delete this.defines.USE_DASH}},dashScale:{enumerable:!0,get:function(){return this.uniforms.dashScale.value},set:function(e){this.uniforms.dashScale.value=e}},dashSize:{enumerable:!0,get:function(){return this.uniforms.dashSize.value},set:function(e){this.uniforms.dashSize.value=e}},dashOffset:{enumerable:!0,get:function(){return this.uniforms.dashOffset.value},set:function(e){this.uniforms.dashOffset.value=e}},gapSize:{enumerable:!0,get:function(){return this.uniforms.gapSize.value},set:function(e){this.uniforms.gapSize.value=e}},opacity:{enumerable:!0,get:function(){return this.uniforms.opacity.value},set:function(e){this.uniforms.opacity.value=e}},resolution:{enumerable:!0,get:function(){return this.uniforms.resolution.value},set:function(e){this.uniforms.resolution.value.copy(e)}},alphaToCoverage:{enumerable:!0,get:function(){return`USE_ALPHA_TO_COVERAGE`in this.defines},set:function(e){!!e!=`USE_ALPHA_TO_COVERAGE`in this.defines&&(this.needsUpdate=!0),e===!0?(this.defines.USE_ALPHA_TO_COVERAGE=``,this.extensions.derivatives=!0):(delete this.defines.USE_ALPHA_TO_COVERAGE,this.extensions.derivatives=!1)}}}),this.setValues(e)}},De=new E,Oe=new _,ke=new _,B=new E,V=new E,H=new E,Ae=new _,je=new d,U=new x,Me=new _,W=new D,G=new C,K=new E,q,J;function Ne(e,t,n){return K.set(0,0,-t,1).applyMatrix4(e.projectionMatrix),K.multiplyScalar(1/K.w),K.x=J/n.width,K.y=J/n.height,K.applyMatrix4(e.projectionMatrixInverse),K.multiplyScalar(1/K.w),Math.abs(Math.max(K.x,K.y))}function Pe(e,t){let n=e.matrixWorld,r=e.geometry,i=r.attributes.instanceStart,a=r.attributes.instanceEnd,o=Math.min(r.instanceCount,i.count);for(let r=0,s=o;r<s;r++){U.start.fromBufferAttribute(i,r),U.end.fromBufferAttribute(a,r),U.applyMatrix4(n);let o=new _,s=new _;q.distanceSqToSegment(U.start,U.end,s,o),s.distanceTo(o)<J*.5&&t.push({point:s,pointOnLine:o,distance:q.origin.distanceTo(s),object:e,face:null,faceIndex:r,uv:null,[Ce]:null})}}function Fe(e,t,n){let r=t.projectionMatrix,i=e.material.resolution,a=e.matrixWorld,o=e.geometry,s=o.attributes.instanceStart,c=o.attributes.instanceEnd,l=Math.min(o.instanceCount,s.count),u=-t.near;q.at(1,H),H.w=1,H.applyMatrix4(t.matrixWorldInverse),H.applyMatrix4(r),H.multiplyScalar(1/H.w),H.x*=i.x/2,H.y*=i.y/2,H.z=0,Ae.copy(H),je.multiplyMatrices(t.matrixWorldInverse,a);for(let t=0,o=l;t<o;t++){if(B.fromBufferAttribute(s,t),V.fromBufferAttribute(c,t),B.w=1,V.w=1,B.applyMatrix4(je),V.applyMatrix4(je),B.z>u&&V.z>u)continue;if(B.z>u){let e=B.z-V.z,t=(B.z-u)/e;B.lerp(V,t)}else if(V.z>u){let e=V.z-B.z,t=(V.z-u)/e;V.lerp(B,t)}B.applyMatrix4(r),V.applyMatrix4(r),B.multiplyScalar(1/B.w),V.multiplyScalar(1/V.w),B.x*=i.x/2,B.y*=i.y/2,V.x*=i.x/2,V.y*=i.y/2,U.start.copy(B),U.start.z=0,U.end.copy(V),U.end.z=0;let o=U.closestPointToPointParameter(Ae,!0);U.at(o,Me);let l=j.lerp(B.z,V.z,o),d=l>=-1&&l<=1,f=Ae.distanceTo(Me)<J*.5;if(d&&f){U.start.fromBufferAttribute(s,t),U.end.fromBufferAttribute(c,t),U.start.applyMatrix4(a),U.end.applyMatrix4(a);let r=new _,i=new _;q.distanceSqToSegment(U.start,U.end,i,r),n.push({point:i,pointOnLine:r,distance:q.origin.distanceTo(i),object:e,face:null,faceIndex:t,uv:null,[Ce]:null})}}}var Ie=class extends A{constructor(e=new z,t=new Ee({color:Math.random()*16777215})){super(e,t),this.isLineSegments2=!0,this.type=`LineSegments2`}computeLineDistances(){let e=this.geometry,t=e.attributes.instanceStart,n=e.attributes.instanceEnd,r=new Float32Array(2*t.count);for(let e=0,i=0,a=t.count;e<a;e++,i+=2)Oe.fromBufferAttribute(t,e),ke.fromBufferAttribute(n,e),r[i]=i===0?0:r[i-1],r[i+1]=r[i]+Oe.distanceTo(ke);let i=new h(r,2,1);return e.setAttribute(`instanceDistanceStart`,new m(i,1,0)),e.setAttribute(`instanceDistanceEnd`,new m(i,1,1)),this}raycast(e,t){let n=this.material.worldUnits,r=e.camera;r===null&&!n&&console.error(`LineSegments2: "Raycaster.camera" needs to be set in order to raycast against LineSegments2 while worldUnits is set to false.`);let i=e.params.Line2===void 0?0:e.params.Line2.threshold||0;q=e.ray;let a=this.matrixWorld,o=this.geometry,s=this.material;J=s.linewidth+i,o.boundingSphere===null&&o.computeBoundingSphere(),G.copy(o.boundingSphere).applyMatrix4(a);let c;if(c=n?J*.5:Ne(r,Math.max(r.near,G.distanceToPoint(q.origin)),s.resolution),G.radius+=c,q.intersectsSphere(G)===!1)return;o.boundingBox===null&&o.computeBoundingBox(),W.copy(o.boundingBox).applyMatrix4(a);let l;l=n?J*.5:Ne(r,Math.max(r.near,W.distanceToPoint(q.origin)),s.resolution),W.expandByScalar(l),q.intersectsBox(W)!==!1&&(n?Pe(this,t):Fe(this,r,t))}onBeforeRender(e){let t=this.material.uniforms;t&&t.resolution&&(e.getViewport(De),this.material.uniforms.resolution.value.set(De.z,De.w))}},Le=class extends Ie{constructor(e=new Te,t=new Ee({color:Math.random()*16777215})){super(e,t),this.isLine2=!0,this.type=`Line2`}},Y=e(s()),Re=Y.forwardRef(function({points:e,color:t=16777215,vertexColors:n,linewidth:r,lineWidth:i,segments:a,dashed:o,...s},c){var l;let u=ye(e=>e.size),d=Y.useMemo(()=>a?new Ie:new Le,[a]),[f]=Y.useState(()=>new Ee),p=(n==null||(l=n[0])==null?void 0:l.length)===4?4:3,m=Y.useMemo(()=>{let r=a?new z:new Te,i=e.map(e=>{let t=Array.isArray(e);return e instanceof _||e instanceof E?[e.x,e.y,e.z]:e instanceof ne?[e.x,e.y,0]:t&&e.length===3?[e[0],e[1],e[2]]:t&&e.length===2?[e[0],e[1],0]:e});if(r.setPositions(i.flat()),n){t=16777215;let e=n.map(e=>e instanceof N?e.toArray():e);r.setColors(e.flat(),p)}return r},[e,a,n,p]);return Y.useLayoutEffect(()=>{d.computeLineDistances()},[e,d]),Y.useLayoutEffect(()=>{o?f.defines.USE_DASH=``:delete f.defines.USE_DASH,f.needsUpdate=!0},[o,f]),Y.useEffect(()=>()=>{m.dispose(),f.dispose()},[m]),Y.createElement(`primitive`,O({object:d,ref:c},s),Y.createElement(`primitive`,{object:m,attach:`geometry`}),Y.createElement(`primitive`,O({object:f,attach:`material`,color:t,vertexColors:!!n,resolution:[u.width,u.height],linewidth:r??i??1,dashed:o,transparent:p===4},s)))}),ze=Y.forwardRef(({threshold:e=15,geometry:t,...n},r)=>{let i=Y.useRef(null);Y.useImperativeHandle(r,()=>i.current,[]);let a=Y.useMemo(()=>[0,0,0,1,0,0],[]),o=Y.useRef(null),s=Y.useRef(null);return Y.useLayoutEffect(()=>{let n=i.current.parent,r=t??n?.geometry;if(!r||o.current===r&&s.current===e)return;o.current=r,s.current=e;let a=new w(r,e).attributes.position.array;i.current.geometry.setPositions(a),i.current.geometry.attributes.instanceStart.needsUpdate=!0,i.current.geometry.attributes.instanceEnd.needsUpdate=!0,i.current.computeLineDistances()}),Y.createElement(Re,O({segments:!0,points:a,ref:i,raycast:()=>null},n))});function Be(e,t){let n=e+`Geometry`;return Y.forwardRef(({args:e,children:r,...i},a)=>{let o=Y.useRef(null);return Y.useImperativeHandle(a,()=>o.current),Y.useLayoutEffect(()=>void t?.(o.current)),Y.createElement(`mesh`,O({ref:o},i),Y.createElement(n,{attach:`geometry`,args:e}),r)})}var Ve=Be(`box`),He=i(`file-input`,[[`path`,{d:`M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4`,key:`1pf5j1`}],[`path`,{d:`M14 2v4a2 2 0 0 0 2 2h4`,key:`tnqrlb`}],[`path`,{d:`M2 15h10`,key:`jfw4w8`}],[`path`,{d:`m9 18 3-3-3-3`,key:`112psh`}]]),Ue=i(`focus`,[[`circle`,{cx:`12`,cy:`12`,r:`3`,key:`1v7zrd`}],[`path`,{d:`M3 7V5a2 2 0 0 1 2-2h2`,key:`aa7l1z`}],[`path`,{d:`M17 3h2a2 2 0 0 1 2 2v2`,key:`4qcy5o`}],[`path`,{d:`M21 17v2a2 2 0 0 1-2 2h-2`,key:`6vwrx8`}],[`path`,{d:`M7 21H5a2 2 0 0 1-2-2v-2`,key:`ioqczr`}]]),We=i(`orbit`,[[`path`,{d:`M20.341 6.484A10 10 0 0 1 10.266 21.85`,key:`1enhxb`}],[`path`,{d:`M3.659 17.516A10 10 0 0 1 13.74 2.152`,key:`1crzgf`}],[`circle`,{cx:`12`,cy:`12`,r:`3`,key:`1v7zrd`}],[`circle`,{cx:`19`,cy:`5`,r:`2`,key:`mhkx31`}],[`circle`,{cx:`5`,cy:`19`,r:`2`,key:`v8kfzx`}]]),Ge=i(`trash-2`,[[`path`,{d:`M10 11v6`,key:`nco0om`}],[`path`,{d:`M14 11v6`,key:`outv1u`}],[`path`,{d:`M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6`,key:`miytrc`}],[`path`,{d:`M3 6h18`,key:`d0wm0j`}],[`path`,{d:`M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2`,key:`e791ji`}]]);function Ke(e,t){let n=t?.input.rolePalette?.roof;return e.block===n||/roof|eave|ridge|gable|tile|finial|soffit/i.test(e.phase)||/roof_tile/.test(e.block)}var X=r(),qe={change:`#e9ad4f`,fix:`#ef6b5b`,remove:`#c74f76`,liked:`#5ec6a7`},Z=({x:e,y:t,z:n})=>`${e},${t},${n}`,Je=e=>e.replace(`minecraft:`,``).split(`_`).map(e=>e[0].toUpperCase()+e.slice(1)).join(` `),Ye=e=>Object.entries(e??{}).sort(([e],[t])=>e.localeCompare(t)).map(([e,t])=>`${e}=${String(t)}`).join(`, `),Q=(e,t)=>String(e.state?.[t]??``),Xe=e=>({north:[0,-1],south:[0,1],west:[-1,0],east:[1,0]})[e]??[0,-1],Ze=e=>({north:0,east:-Math.PI/2,south:Math.PI,west:Math.PI/2})[e]??0;function Qe(e){return/lantern|glowstone|froglight|shroomlight/.test(e)?`#e9ad4f`:/deepslate|blackstone|coal/.test(e)?`#30383d`:/stone|tuff|andesite|cobble/.test(e)?`#747a78`:/mangrove|crimson|brick|terracotta/.test(e)?`#7d3428`:/spruce|dark_oak/.test(e)?`#49311f`:/oak|bamboo|birch/.test(e)?`#ad8250`:/glass|pane|ice/.test(e)?`#8fc4cc`:/moss|grass|leaves|vine/.test(e)?`#52724c`:`#9ba0a2`}function $e(e){let t=e.block,n=Q(e,`facing`)||`north`,r=Q(e,`half`)||`bottom`,[i,a]=Xe(n);if(t.endsWith(`_slab`)){let t=Q(e,`type`)||`bottom`;return t===`double`?[{size:[1,1,1],offset:[0,0,0]}]:[{size:[1,.5,1],offset:[0,t===`top`?.25:-.25,0]}]}if(t.endsWith(`_stairs`)){let e=r===`top`;return[{size:[1,.5,1],offset:[0,e?.25:-.25,0]},{size:[Math.abs(i)?.5:1,.5,Math.abs(a)?.5:1],offset:[i*.25,e?-.25:.25,a*.25]}]}if(t.endsWith(`_trapdoor`))return Q(e,`open`)===`true`?[{size:[Math.abs(i)?.1875:1,1,Math.abs(a)?.1875:1],offset:[i*.40625,0,a*.40625]}]:[{size:[1,.1875,1],offset:[0,r===`top`?.40625:-.40625,0]}];if(/glass_pane|iron_bars/.test(t)){let t=[{size:[.125,1,.125],offset:[0,0,0]}];return Q(e,`north`)===`true`&&t.push({size:[.125,1,.5],offset:[0,0,-.25]}),Q(e,`south`)===`true`&&t.push({size:[.125,1,.5],offset:[0,0,.25]}),Q(e,`west`)===`true`&&t.push({size:[.5,1,.125],offset:[-.25,0,0]}),Q(e,`east`)===`true`&&t.push({size:[.5,1,.125],offset:[.25,0,0]}),t}if(/_fence$|_wall$/.test(t)){let t=[{size:[.25,1,.25],offset:[0,0,0]}],n=t=>[`true`,`low`,`tall`].includes(Q(e,t));return n(`north`)&&t.push({size:[.25,.5,.5],offset:[0,.05,-.25]}),n(`south`)&&t.push({size:[.25,.5,.5],offset:[0,.05,.25]}),n(`west`)&&t.push({size:[.5,.5,.25],offset:[-.25,.05,0]}),n(`east`)&&t.push({size:[.5,.5,.25],offset:[.25,.05,0]}),t}return/_door$/.test(t)&&!/_trapdoor$/.test(t)?[{size:[1,1,.1875],offset:[0,0,0],rotationY:Ze(n)}]:/(^|:)lantern$|soul_lantern$/.test(t)?[{size:[.5,.5,.5],offset:[0,-.05,0],role:`lantern`},{size:[.25,.18,.25],offset:[0,.29,0],role:`metal`},...Q(e,`hanging`)===`true`?[{size:[.12,.28,.12],offset:[0,.43,0],role:`metal`}]:[]]:[{size:[1,1,1],offset:[0,0,0]}]}function et({placements:e,part:t,block:n,textures:r,dimmed:i,onPick:a}){let o=(0,Y.useRef)(null),s=(0,Y.useMemo)(()=>{let e=r?.top,a=e?new F().load(e):void 0;a&&(a.colorSpace=v,a.magFilter=b,a.minFilter=S);let o=t.role===`lantern`?new N(`#b86b22`):new N(`#000000`);return new y({color:e?`#ffffff`:t.role===`metal`?`#242a2c`:Qe(n),map:a,roughness:t.role===`metal`?.45:.88,metalness:t.role===`metal`?.5:0,transparent:i||/glass|pane|leaves/.test(n),opacity:i?.2:1,alphaTest:/glass|pane|leaves|door|trapdoor/.test(n)?.08:0,emissive:o,emissiveIntensity:t.role===`lantern`?1.1:0})},[n,i,t.role,r?.top]);return(0,Y.useEffect)(()=>()=>{s.map?.dispose(),s.dispose()},[s]),(0,Y.useEffect)(()=>{if(!o.current)return;let n=new d,r=new g().setFromEuler(new p(0,t.rotationY??0,0));e.forEach((e,i)=>{n.compose(new _(e.x+t.offset[0],e.y+t.offset[1],e.z+t.offset[2]),r,new _(...t.size)),o.current.setMatrixAt(i,n)}),o.current.instanceMatrix.needsUpdate=!0},[e,t]),(0,X.jsx)(`instancedMesh`,{ref:o,args:[void 0,void 0,e.length],material:s,frustumCulled:!1,onClick:t=>{t.stopPropagation(),t.instanceId!==void 0&&a(e[t.instanceId])},children:(0,X.jsx)(`boxGeometry`,{args:[1,1,1]})})}function tt({selection:e,color:t=`#f2b661`}){if(!e)return null;let n=[e.max.x-e.min.x+1.08,e.max.y-e.min.y+1.08,e.max.z-e.min.z+1.08],r=[(e.min.x+e.max.x)/2,(e.min.y+e.max.y)/2,(e.min.z+e.max.z)/2];return(0,X.jsxs)(Ve,{args:n,position:r,children:[(0,X.jsx)(`meshBasicMaterial`,{transparent:!0,opacity:.035,color:t,depthWrite:!1}),(0,X.jsx)(ze,{color:t})]})}function nt({build:e,maxLayer:t,hideRoof:n,cameraPreset:r,orthographic:i,selection:a,annotations:o,texturePack:s,onPick:c}){let l=(0,Y.useMemo)(()=>{let r=new Map;for(let i of e.placements){if(i.y>t||n&&Ke(i,e))continue;let a=I(i.block,i.state),o=r.get(a)??{placement:i,placements:[],parts:$e(i)};o.placements.push(i),r.set(a,o)}return[...r.entries()]},[e,n,t]),u=[(e.bounds.min.x+e.bounds.max.x)/2,(e.bounds.min.y+e.bounds.max.y)/2,(e.bounds.min.z+e.bounds.max.z)/2],d=Math.max(e.bounds.dimensions.width,e.bounds.dimensions.depth,e.bounds.dimensions.height)*1.35,f={iso:[u[0]+d,u[1]+d*.65,u[2]-d],top:[u[0],u[1]+d*1.6,u[2]+.01],north:[u[0],u[1]+d*.3,u[2]-d*1.3],south:[u[0],u[1]+d*.3,u[2]+d*1.3],east:[u[0]+d*1.3,u[1]+d*.3,u[2]],west:[u[0]-d*1.3,u[1]+d*.3,u[2]]};return(0,X.jsxs)(ie,{shadows:!0,dpr:[1,1.5],gl:{antialias:!0,alpha:!1},onPointerMissed:()=>void 0,children:[(0,X.jsx)(`color`,{attach:`background`,args:[`#06141e`]}),i?(0,X.jsx)(k,{makeDefault:!0,position:f[r],zoom:Math.max(4,850/d),onUpdate:e=>e.lookAt(...u)},`review-ortho-${r}`):(0,X.jsx)(de,{makeDefault:!0,position:f[r],fov:42,onUpdate:e=>e.lookAt(...u)},`review-perspective-${r}`),(0,X.jsx)(`ambientLight`,{intensity:1.05,color:`#a8bfd0`}),(0,X.jsx)(`directionalLight`,{position:[u[0]+d,u[1]+d,u[2]-d],intensity:2.2,color:`#f5e7cf`,castShadow:!0}),l.flatMap(([e,t])=>t.parts.map((n,r)=>(0,X.jsx)(et,{placements:t.placements,part:n,block:t.placement.block,textures:s?.textures.get(e),dimmed:!1,onPick:c},`${e}-${r}`))),(0,X.jsx)(tt,{selection:a}),o.map(e=>(0,X.jsx)(tt,{selection:e.bounds,color:qe[e.category]},e.id)),(0,X.jsx)(ce,{position:[u[0],e.bounds.min.y-.51,u[2]],args:[Math.max(64,d*2),Math.max(64,d*2)],cellSize:1,cellColor:`#294554`,sectionSize:5,sectionColor:`#3f6170`,fadeDistance:d*1.8,infiniteGrid:!0}),(0,X.jsx)(me,{makeDefault:!0,target:u,minDistance:3,maxDistance:d*4,maxPolarAngle:Math.PI/2.01,enabled:!0})]})}function rt(e,t){return e.placements.filter(e=>e.x>=t.min.x&&e.x<=t.max.x&&e.y>=t.min.y&&e.y<=t.max.y&&e.z>=t.min.z&&e.z<=t.max.z).length}function it(e,t){return{min:{x:Math.min(e.x,t.x),y:Math.min(e.y,t.y),z:Math.min(e.z,t.z)},max:{x:Math.max(e.x,t.x),y:Math.max(e.y,t.y),z:Math.max(e.z,t.z)}}}function $({label:e,active:t,onClick:n,children:r}){return(0,X.jsx)(`button`,{className:`review-icon-button ${t?`active`:``}`,"aria-label":e,title:e,onClick:n,children:r})}function at(){let{output:e,isPending:t,responseMetadata:r}=o(),[i,s]=a(),{maxHeight:d}=n(),{download:f}=ee(),p=r?.build,m=r?.audit,h=e?.review,g=p?.bounds.max.y??0,_=p?.bounds.min.y??0,[{mode:v,layer:te,hideRoof:y,orthographic:b,cameraPreset:x,annotations:S,selection:C,anchor:w},T]=l({mode:`orbit`,layer:g,hideRoof:!1,orthographic:!1,cameraPreset:`iso`,annotations:[],selection:void 0,anchor:void 0}),[E,ne]=(0,Y.useState)(`fix`),[re,ie]=(0,Y.useState)(``),[D,ce]=(0,Y.useState)(null),[O,k]=(0,Y.useState)(`Procedural fallback`),A=(0,Y.useRef)(null),j=(0,Y.useRef)(null);if((0,Y.useEffect)(()=>{p&&T(e=>({...e,layer:e.layer<p.bounds.min.y||e.layer>p.bounds.max.y?p.bounds.max.y:e.layer}))},[p?.id]),(0,Y.useEffect)(()=>()=>D?.dispose(),[D]),t||!p||!h||!m)return(0,X.jsxs)(`div`,{className:`loading-view`,children:[(0,X.jsx)(se,{size:34}),(0,X.jsx)(`span`,{children:`Preparing exact 3D review…`})]});let de=e=>{let t={x:e.x,y:e.y,z:e.z};if(v===`orbit`)return;if(v===`select`){let n=it(t,t);T(t=>({...t,selection:{...n,type:`block`,blockCount:1,pickedBlock:e.block,pickedState:e.state},anchor:void 0}));return}if(!w){T(e=>({...e,anchor:t,selection:void 0}));return}let n=it(w,t);T(t=>({...t,anchor:void 0,selection:{...n,type:v===`measure`?`measure`:`region`,blockCount:rt(p,n),pickedBlock:e.block,pickedState:e.state}}))},me=()=>{if(!C||C.type===`measure`)return;let e={id:`review_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`,category:E,note:re.trim(),bounds:{min:C.min,max:C.max},blockCount:C.blockCount,pickedBlock:C.pickedBlock,pickedState:C.pickedState,createdAt:new Date().toISOString()};T(t=>({...t,annotations:[e,...t.annotations],selection:void 0})),ie(``)},ye=async()=>{let e=p.input.name.toLowerCase().replace(/[^a-z0-9]+/g,`-`).replace(/^-|-$/g,``)||`blockwright-build`,t={schemaVersion:1,type:`blockwright-review`,build:{id:p.id,hash:p.hash,name:p.input.name,edition:p.input.edition,version:p.input.version,bounds:p.bounds},annotations:S,audit:m,exportedAt:new Date().toISOString()};await f({contents:[{type:`resource`,resource:{uri:`file:///${e}-review.json`,mimeType:`application/json`,text:JSON.stringify(t,null,2)}}]})},M=async e=>{if(!e)return;let t=JSON.parse(await e.text());if(t.type!==`blockwright-review`||t.build?.hash!==p.hash||!Array.isArray(t.annotations))throw Error(`This review is not for the current immutable build hash.`);T(e=>({...e,annotations:t.annotations??[]}))},N=async e=>{if(e){k(`Reading ${e.name}…`);try{let t=await Se(e,p.placements);ce(e=>(e?.dispose(),t)),k(`${t.name} · ${t.resolved}/${t.requested} states resolved`)}catch(e){k(e instanceof Error?e.message:`Could not read this resource pack.`)}}},P=C?.type===`measure`?{dx:C.max.x-C.min.x,dy:C.max.y-C.min.y,dz:C.max.z-C.min.z,length:Math.hypot(C.max.x-C.min.x,C.max.y-C.min.y,C.max.z-C.min.z)}:void 0,F=C?.pickedState?Ye(C.pickedState):``,I=Math.max(_,Math.min(te,g)),L=`Reviewing ${p.input.name}, hash ${p.hash.slice(0,12)}. ${S.length} annotations. ${C?`Selected ${C.type} from ${Z(C.min)} to ${Z(C.max)}.`:`No selection.`} ${y?`Roof blocks hidden.`:`Roof blocks visible.`} Global audit: ${m.totals.errors} errors and ${m.totals.warnings} warnings across ${m.scannedPlacements} placements.`;return i===`fullscreen`?(0,X.jsx)(u,{content:L,children:(0,X.jsxs)(`main`,{className:`review-shell`,style:{maxHeight:d||void 0},children:[(0,X.jsxs)(`header`,{className:`review-header`,children:[(0,X.jsxs)(`div`,{children:[(0,X.jsx)(`span`,{className:`panel-kicker`,children:`Blockwright reviewer`}),(0,X.jsx)(`h1`,{children:p.input.name})]}),(0,X.jsxs)(`div`,{className:`review-header-actions`,children:[(0,X.jsxs)(`button`,{onClick:()=>j.current?.click(),children:[(0,X.jsx)(xe,{size:15}),`Textures`]}),(0,X.jsxs)(`button`,{onClick:()=>A.current?.click(),children:[(0,X.jsx)(He,{size:15}),`Import review`]}),(0,X.jsxs)(`button`,{className:`primary-button`,onClick:()=>void ye(),children:[(0,X.jsx)(pe,{size:15}),`Export review`]}),(0,X.jsx)($,{label:`Collapse reviewer`,onClick:()=>s(`inline`),children:(0,X.jsx)(c,{size:16})})]}),(0,X.jsx)(`input`,{ref:j,hidden:!0,type:`file`,accept:`.zip,.jar,application/zip,application/java-archive`,onChange:e=>void N(e.target.files?.[0])}),(0,X.jsx)(`input`,{ref:A,hidden:!0,type:`file`,accept:`.json,application/json`,onChange:e=>void M(e.target.files?.[0])})]}),(0,X.jsxs)(`aside`,{className:`review-tools`,"aria-label":`Review tools`,children:[(0,X.jsx)($,{label:`Orbit`,active:v===`orbit`,onClick:()=>T(e=>({...e,mode:`orbit`,anchor:void 0})),children:(0,X.jsx)(We,{size:19})}),(0,X.jsx)($,{label:`Select block`,active:v===`select`,onClick:()=>T(e=>({...e,mode:`select`,anchor:void 0})),children:(0,X.jsx)(he,{size:19})}),(0,X.jsx)($,{label:`Select region`,active:v===`region`,onClick:()=>T(e=>({...e,mode:`region`,anchor:void 0})),children:(0,X.jsx)(_e,{size:19})}),(0,X.jsx)($,{label:`Measure`,active:v===`measure`,onClick:()=>T(e=>({...e,mode:`measure`,anchor:void 0})),children:(0,X.jsx)(fe,{size:19})}),(0,X.jsx)(`span`,{}),(0,X.jsx)($,{label:`Top`,active:x===`top`,onClick:()=>T(e=>({...e,cameraPreset:`top`})),children:(0,X.jsx)(ge,{size:19})}),(0,X.jsx)($,{label:`North`,active:x===`north`,onClick:()=>T(e=>({...e,cameraPreset:`north`})),children:(0,X.jsx)(ve,{size:19})}),(0,X.jsx)($,{label:`West`,active:x===`west`,onClick:()=>T(e=>({...e,cameraPreset:`west`})),children:(0,X.jsx)(ue,{size:19})}),(0,X.jsx)($,{label:`East`,active:x===`east`,onClick:()=>T(e=>({...e,cameraPreset:`east`})),children:(0,X.jsx)(oe,{size:19})}),(0,X.jsx)($,{label:`Isometric`,active:x===`iso`,onClick:()=>T(e=>({...e,cameraPreset:`iso`})),children:(0,X.jsx)(Ue,{size:19})})]}),(0,X.jsxs)(`section`,{className:`review-viewport`,children:[(0,X.jsx)(nt,{build:p,maxLayer:I,hideRoof:y,cameraPreset:x,orthographic:b,selection:C,annotations:S,texturePack:D,onPick:de}),(0,X.jsxs)(`div`,{className:`review-view-switch`,children:[(0,X.jsx)(`button`,{className:b?``:`active`,onClick:()=>T(e=>({...e,orthographic:!1})),children:`Perspective`}),(0,X.jsx)(`button`,{className:b?`active`:``,onClick:()=>T(e=>({...e,orthographic:!0})),children:`Orthographic`})]}),(0,X.jsxs)(`div`,{className:`review-layer-control`,children:[(0,X.jsx)(le,{size:15}),(0,X.jsx)(`input`,{"aria-label":`Maximum visible Y layer`,type:`range`,min:_,max:g,value:I,onChange:e=>T(t=>({...t,layer:Number(e.target.value)}))}),(0,X.jsxs)(`strong`,{children:[`Y ≤ `,I]}),(0,X.jsxs)(`label`,{children:[(0,X.jsx)(`input`,{type:`checkbox`,checked:y,onChange:e=>T(t=>({...t,hideRoof:e.target.checked}))}),`Hide roof`]})]}),w&&(0,X.jsxs)(`div`,{className:`review-instruction`,children:[`First corner: `,Z(w),` · choose the second point`]})]}),(0,X.jsxs)(`aside`,{className:`review-inspector`,children:[(0,X.jsxs)(`section`,{children:[(0,X.jsxs)(`div`,{className:`review-section-heading`,children:[(0,X.jsx)(`span`,{className:`panel-kicker`,children:`Annotation`}),(0,X.jsx)(`small`,{children:`exact world coordinates`})]}),(0,X.jsx)(`div`,{className:`review-category-row`,children:[`change`,`fix`,`remove`,`liked`].map(e=>(0,X.jsx)(`button`,{className:E===e?`active`:``,style:{"--category":qe[e]},onClick:()=>ne(e),children:e},e))}),(0,X.jsx)(`textarea`,{value:re,onChange:e=>ie(e.target.value),placeholder:`Describe the issue, intent, or detail to preserve…`}),(0,X.jsxs)(`button`,{className:`primary-button review-save`,disabled:!C||C.type===`measure`,onClick:me,children:[(0,X.jsx)(be,{size:15}),`Save annotation`]})]}),(0,X.jsxs)(`section`,{children:[(0,X.jsxs)(`div`,{className:`review-section-heading`,children:[(0,X.jsx)(`span`,{className:`panel-kicker`,children:`Selection`}),(0,X.jsx)(`small`,{children:C?.type??`none`})]}),C?(0,X.jsxs)(`div`,{className:`review-selection-card`,children:[(0,X.jsxs)(`strong`,{children:[C.blockCount.toLocaleString(),` block`,C.blockCount===1?``:`s`]}),(0,X.jsxs)(`span`,{children:[`Min `,Z(C.min)]}),(0,X.jsxs)(`span`,{children:[`Max `,Z(C.max)]}),C.pickedBlock&&(0,X.jsx)(`span`,{children:Je(C.pickedBlock)}),F&&(0,X.jsx)(`code`,{children:F}),P&&(0,X.jsxs)(`span`,{children:[`Δ `,P.dx,`, `,P.dy,`, `,P.dz,` · `,P.length.toFixed(2),` blocks`]})]}):(0,X.jsx)(`p`,{className:`review-empty`,children:`Choose block or region select, then click the model.`})]}),(0,X.jsxs)(`section`,{children:[(0,X.jsxs)(`div`,{className:`review-section-heading`,children:[(0,X.jsx)(`span`,{className:`panel-kicker`,children:`Global audit`}),(0,X.jsxs)(`small`,{children:[m.scannedPlacements.toLocaleString(),` scanned`]})]}),(0,X.jsxs)(`div`,{className:`audit-totals`,children:[(0,X.jsxs)(`span`,{children:[(0,X.jsx)(`b`,{children:m.totals.errors}),` errors`]}),(0,X.jsxs)(`span`,{children:[(0,X.jsx)(`b`,{children:m.totals.warnings}),` warnings`]}),(0,X.jsxs)(`span`,{children:[(0,X.jsx)(`b`,{children:m.statefulPlacements.toLocaleString()}),` stateful`]})]}),(0,X.jsx)(`div`,{className:`audit-findings`,children:m.findings.length?m.findings.slice(0,8).map(e=>(0,X.jsxs)(`button`,{onClick:()=>e.coordinates[0]&&T(t=>({...t,selection:{...it(e.coordinates[0],e.coordinates[0]),type:`block`,blockCount:1}})),children:[(0,X.jsx)(`span`,{className:`audit-dot ${e.severity}`}),(0,X.jsxs)(`span`,{children:[(0,X.jsx)(`strong`,{children:e.code.replaceAll(`_`,` `)}),(0,X.jsxs)(`small`,{children:[e.total.toLocaleString(),` · `,e.message]})]})]},e.code)):(0,X.jsxs)(`div`,{className:`review-pass`,children:[(0,X.jsx)(be,{size:16}),`No structural audit findings`]})})]}),(0,X.jsxs)(`section`,{className:`review-history-section`,children:[(0,X.jsxs)(`div`,{className:`review-section-heading`,children:[(0,X.jsx)(`span`,{className:`panel-kicker`,children:`Annotation history`}),(0,X.jsx)(`small`,{children:S.length})]}),(0,X.jsx)(`div`,{className:`review-history`,children:S.length?S.map(e=>(0,X.jsxs)(`button`,{onClick:()=>T(t=>({...t,selection:{...e.bounds,type:e.bounds.min.x===e.bounds.max.x&&e.bounds.min.y===e.bounds.max.y&&e.bounds.min.z===e.bounds.max.z?`block`:`region`,blockCount:e.blockCount,pickedBlock:e.pickedBlock,pickedState:e.pickedState}})),children:[(0,X.jsx)(`i`,{style:{background:qe[e.category]}}),(0,X.jsxs)(`span`,{children:[(0,X.jsxs)(`strong`,{children:[e.category,` · `,e.blockCount,` block`,e.blockCount===1?``:`s`]}),(0,X.jsx)(`small`,{children:e.note||Z(e.bounds.min)})]}),(0,X.jsx)(Ge,{size:14,onClick:t=>{t.stopPropagation(),T(t=>({...t,annotations:t.annotations.filter(t=>t.id!==e.id)}))}})]},e.id)):(0,X.jsx)(`p`,{className:`review-empty`,children:`No annotations yet.`})})]})]}),(0,X.jsxs)(`footer`,{className:`review-status`,children:[(0,X.jsxs)(`span`,{children:[(0,X.jsx)(`i`,{}),`Ready`]}),(0,X.jsx)(`span`,{children:v===`orbit`?`Orbit, pan, and zoom`:w?`Choose the second point`:`Review mode: ${v}`}),(0,X.jsx)(`span`,{children:O}),(0,X.jsxs)(`strong`,{children:[p.placements.length.toLocaleString(),` blocks · `,p.hash.slice(0,8)]}),(0,X.jsx)(ae,{size:16})]})]})}):(0,X.jsx)(u,{content:L,children:(0,X.jsxs)(`section`,{className:`inline-summary review-inline`,children:[(0,X.jsx)(`div`,{className:`brand-cube`,children:(0,X.jsx)(ae,{size:22})}),(0,X.jsxs)(`div`,{children:[(0,X.jsxs)(`h2`,{children:[`Review `,p.input.name]}),(0,X.jsxs)(`p`,{children:[p.placements.length.toLocaleString(),` exact blocks · `,m.findings.length,` audit categories · `,S.length,` annotations`]})]}),(0,X.jsxs)(`button`,{className:`primary-button`,onClick:()=>s(`fullscreen`),children:[(0,X.jsx)(c,{size:16}),`Open reviewer`]})]})})}t((0,Y.createElement)(at));