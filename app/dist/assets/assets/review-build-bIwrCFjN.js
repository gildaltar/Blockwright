import{O as e,T as t}from"./v4-BJmWi5kg.js";import{a as n,c as r,d as i,i as a,l as o,n as s,p as c,r as l,s as u,u as ee}from"./helpers-DGW9OV4V.js";import{A as d,B as f,C as p,D as m,E as h,F as te,G as g,H as ne,I as _,J as re,K as v,L as y,M as b,N as ie,O as x,P as S,R as C,S as w,T as ae,U as T,V as E,W as D,_ as O,a as oe,b as se,c as ce,d as le,f as ue,g as de,h as fe,i as pe,j as me,k as he,l as ge,m as _e,n as ve,o as ye,p as be,q as xe,r as Se,s as Ce,t as we,u as Te,v as Ee,w as k,x as A,y as j,z as M}from"./use-paged-build-BlcNcz0L.js";import{i as De,n as Oe,r as ke,t as Ae}from"./resource-pack-D9rEeToN.js";var je=parseInt(`179`.replace(/\D+/g,``)),N=je>=125?`uv1`:`uv2`,P=new p,F=new g,I=class extends x{constructor(){super(),this.isLineSegmentsGeometry=!0,this.type=`LineSegmentsGeometry`,this.setIndex([0,2,1,2,3,1,2,4,3,4,5,3,4,6,5,6,7,5]),this.setAttribute(`position`,new m([-1,2,0,1,2,0,-1,1,0,1,1,0,-1,0,0,1,0,0,-1,-1,0,1,-1,0],3)),this.setAttribute(`uv`,new m([-1,2,1,2,-1,1,1,1,-1,-1,1,-1,-1,-2,1,-2],2))}applyMatrix4(e){let t=this.attributes.instanceStart,n=this.attributes.instanceEnd;return t!==void 0&&(t.applyMatrix4(e),n.applyMatrix4(e),t.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}setPositions(e){let t;e instanceof Float32Array?t=e:Array.isArray(e)&&(t=new Float32Array(e));let n=new he(t,6,1);return this.setAttribute(`instanceStart`,new d(n,3,0)),this.setAttribute(`instanceEnd`,new d(n,3,3)),this.computeBoundingBox(),this.computeBoundingSphere(),this}setColors(e,t=3){let n;e instanceof Float32Array?n=e:Array.isArray(e)&&(n=new Float32Array(e));let r=new he(n,t*2,1);return this.setAttribute(`instanceColorStart`,new d(r,t,0)),this.setAttribute(`instanceColorEnd`,new d(r,t,t)),this}fromWireframeGeometry(e){return this.setPositions(e.attributes.position.array),this}fromEdgesGeometry(e){return this.setPositions(e.attributes.position.array),this}fromMesh(e){return this.fromWireframeGeometry(new xe(e.geometry)),this}fromLineSegments(e){let t=e.geometry;return this.setPositions(t.attributes.position.array),this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new p);let e=this.attributes.instanceStart,t=this.attributes.instanceEnd;e!==void 0&&t!==void 0&&(this.boundingBox.setFromBufferAttribute(e),P.setFromBufferAttribute(t),this.boundingBox.union(P))}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new E),this.boundingBox===null&&this.computeBoundingBox();let e=this.attributes.instanceStart,t=this.attributes.instanceEnd;if(e!==void 0&&t!==void 0){let n=this.boundingSphere.center;this.boundingBox.getCenter(n);let r=0;for(let i=0,a=e.count;i<a;i++)F.fromBufferAttribute(e,i),r=Math.max(r,n.distanceToSquared(F)),F.fromBufferAttribute(t,i),r=Math.max(r,n.distanceToSquared(F));this.boundingSphere.radius=Math.sqrt(r),isNaN(this.boundingSphere.radius)&&console.error(`THREE.LineSegmentsGeometry.computeBoundingSphere(): Computed radius is NaN. The instanced position data is likely to have NaN values.`,this)}}toJSON(){}applyMatrix(e){return console.warn(`THREE.LineSegmentsGeometry: applyMatrix() has been renamed to applyMatrix4().`),this.applyMatrix4(e)}},Me=class extends I{constructor(){super(),this.isLineGeometry=!0,this.type=`LineGeometry`}setPositions(e){let t=e.length-3,n=new Float32Array(2*t);for(let r=0;r<t;r+=3)n[2*r]=e[r],n[2*r+1]=e[r+1],n[2*r+2]=e[r+2],n[2*r+3]=e[r+3],n[2*r+4]=e[r+4],n[2*r+5]=e[r+5];return super.setPositions(n),this}setColors(e,t=3){let n=e.length-t,r=new Float32Array(2*n);if(t===3)for(let i=0;i<n;i+=t)r[2*i]=e[i],r[2*i+1]=e[i+1],r[2*i+2]=e[i+2],r[2*i+3]=e[i+3],r[2*i+4]=e[i+4],r[2*i+5]=e[i+5];else for(let i=0;i<n;i+=t)r[2*i]=e[i],r[2*i+1]=e[i+1],r[2*i+2]=e[i+2],r[2*i+3]=e[i+3],r[2*i+4]=e[i+4],r[2*i+5]=e[i+5],r[2*i+6]=e[i+6],r[2*i+7]=e[i+7];return super.setColors(r,t),this}fromLine(e){let t=e.geometry;return this.setPositions(t.attributes.position.array),this}},Ne=class extends f{constructor(e){super({type:`LineMaterial`,uniforms:T.clone(T.merge([w.common,w.fog,{worldUnits:{value:1},linewidth:{value:1},resolution:{value:new D(1,1)},dashOffset:{value:0},dashScale:{value:1},dashSize:{value:1},gapSize:{value:1}}])),vertexShader:`
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
					#include <${je>=154?`colorspace_fragment`:`encodings_fragment`}>
					#include <fog_fragment>
					#include <premultiplied_alpha_fragment>

				}
			`,clipping:!0}),this.isLineMaterial=!0,this.onBeforeCompile=function(){this.transparent?this.defines.USE_LINE_COLOR_ALPHA=`1`:delete this.defines.USE_LINE_COLOR_ALPHA},Object.defineProperties(this,{color:{enumerable:!0,get:function(){return this.uniforms.diffuse.value},set:function(e){this.uniforms.diffuse.value=e}},worldUnits:{enumerable:!0,get:function(){return`WORLD_UNITS`in this.defines},set:function(e){e===!0?this.defines.WORLD_UNITS=``:delete this.defines.WORLD_UNITS}},linewidth:{enumerable:!0,get:function(){return this.uniforms.linewidth.value},set:function(e){this.uniforms.linewidth.value=e}},dashed:{enumerable:!0,get:function(){return`USE_DASH`in this.defines},set(e){!!e!=`USE_DASH`in this.defines&&(this.needsUpdate=!0),e===!0?this.defines.USE_DASH=``:delete this.defines.USE_DASH}},dashScale:{enumerable:!0,get:function(){return this.uniforms.dashScale.value},set:function(e){this.uniforms.dashScale.value=e}},dashSize:{enumerable:!0,get:function(){return this.uniforms.dashSize.value},set:function(e){this.uniforms.dashSize.value=e}},dashOffset:{enumerable:!0,get:function(){return this.uniforms.dashOffset.value},set:function(e){this.uniforms.dashOffset.value=e}},gapSize:{enumerable:!0,get:function(){return this.uniforms.gapSize.value},set:function(e){this.uniforms.gapSize.value=e}},opacity:{enumerable:!0,get:function(){return this.uniforms.opacity.value},set:function(e){this.uniforms.opacity.value=e}},resolution:{enumerable:!0,get:function(){return this.uniforms.resolution.value},set:function(e){this.uniforms.resolution.value.copy(e)}},alphaToCoverage:{enumerable:!0,get:function(){return`USE_ALPHA_TO_COVERAGE`in this.defines},set:function(e){!!e!=`USE_ALPHA_TO_COVERAGE`in this.defines&&(this.needsUpdate=!0),e===!0?(this.defines.USE_ALPHA_TO_COVERAGE=``,this.extensions.derivatives=!0):(delete this.defines.USE_ALPHA_TO_COVERAGE,this.extensions.derivatives=!1)}}}),this.setValues(e)}},Pe=new v,Fe=new g,Ie=new g,L=new v,R=new v,z=new v,B=new g,Le=new ie,V=new me,Re=new g,H=new p,U=new E,W=new v,G,K;function ze(e,t,n){return W.set(0,0,-t,1).applyMatrix4(e.projectionMatrix),W.multiplyScalar(1/W.w),W.x=K/n.width,W.y=K/n.height,W.applyMatrix4(e.projectionMatrixInverse),W.multiplyScalar(1/W.w),Math.abs(Math.max(W.x,W.y))}function Be(e,t){let n=e.matrixWorld,r=e.geometry,i=r.attributes.instanceStart,a=r.attributes.instanceEnd,o=Math.min(r.instanceCount,i.count);for(let r=0,s=o;r<s;r++){V.start.fromBufferAttribute(i,r),V.end.fromBufferAttribute(a,r),V.applyMatrix4(n);let o=new g,s=new g;G.distanceSqToSegment(V.start,V.end,s,o),s.distanceTo(o)<K*.5&&t.push({point:s,pointOnLine:o,distance:G.origin.distanceTo(s),object:e,face:null,faceIndex:r,uv:null,[N]:null})}}function Ve(e,t,n){let r=t.projectionMatrix,i=e.material.resolution,a=e.matrixWorld,o=e.geometry,s=o.attributes.instanceStart,c=o.attributes.instanceEnd,l=Math.min(o.instanceCount,s.count),u=-t.near;G.at(1,z),z.w=1,z.applyMatrix4(t.matrixWorldInverse),z.applyMatrix4(r),z.multiplyScalar(1/z.w),z.x*=i.x/2,z.y*=i.y/2,z.z=0,B.copy(z),Le.multiplyMatrices(t.matrixWorldInverse,a);for(let t=0,o=l;t<o;t++){if(L.fromBufferAttribute(s,t),R.fromBufferAttribute(c,t),L.w=1,R.w=1,L.applyMatrix4(Le),R.applyMatrix4(Le),L.z>u&&R.z>u)continue;if(L.z>u){let e=L.z-R.z,t=(L.z-u)/e;L.lerp(R,t)}else if(R.z>u){let e=R.z-L.z,t=(R.z-u)/e;R.lerp(L,t)}L.applyMatrix4(r),R.applyMatrix4(r),L.multiplyScalar(1/L.w),R.multiplyScalar(1/R.w),L.x*=i.x/2,L.y*=i.y/2,R.x*=i.x/2,R.y*=i.y/2,V.start.copy(L),V.start.z=0,V.end.copy(R),V.end.z=0;let o=V.closestPointToPointParameter(B,!0);V.at(o,Re);let l=b.lerp(L.z,R.z,o),ee=l>=-1&&l<=1,d=B.distanceTo(Re)<K*.5;if(ee&&d){V.start.fromBufferAttribute(s,t),V.end.fromBufferAttribute(c,t),V.start.applyMatrix4(a),V.end.applyMatrix4(a);let r=new g,i=new g;G.distanceSqToSegment(V.start,V.end,i,r),n.push({point:i,pointOnLine:r,distance:G.origin.distanceTo(i),object:e,face:null,faceIndex:t,uv:null,[N]:null})}}}var He=class extends S{constructor(e=new I,t=new Ne({color:Math.random()*16777215})){super(e,t),this.isLineSegments2=!0,this.type=`LineSegments2`}computeLineDistances(){let e=this.geometry,t=e.attributes.instanceStart,n=e.attributes.instanceEnd,r=new Float32Array(2*t.count);for(let e=0,i=0,a=t.count;e<a;e++,i+=2)Fe.fromBufferAttribute(t,e),Ie.fromBufferAttribute(n,e),r[i]=i===0?0:r[i-1],r[i+1]=r[i]+Fe.distanceTo(Ie);let i=new he(r,2,1);return e.setAttribute(`instanceDistanceStart`,new d(i,1,0)),e.setAttribute(`instanceDistanceEnd`,new d(i,1,1)),this}raycast(e,t){let n=this.material.worldUnits,r=e.camera;r===null&&!n&&console.error(`LineSegments2: "Raycaster.camera" needs to be set in order to raycast against LineSegments2 while worldUnits is set to false.`);let i=e.params.Line2===void 0?0:e.params.Line2.threshold||0;G=e.ray;let a=this.matrixWorld,o=this.geometry,s=this.material;K=s.linewidth+i,o.boundingSphere===null&&o.computeBoundingSphere(),U.copy(o.boundingSphere).applyMatrix4(a);let c;if(c=n?K*.5:ze(r,Math.max(r.near,U.distanceToPoint(G.origin)),s.resolution),U.radius+=c,G.intersectsSphere(U)===!1)return;o.boundingBox===null&&o.computeBoundingBox(),H.copy(o.boundingBox).applyMatrix4(a);let l;l=n?K*.5:ze(r,Math.max(r.near,H.distanceToPoint(G.origin)),s.resolution),H.expandByScalar(l),G.intersectsBox(H)!==!1&&(n?Be(this,t):Ve(this,r,t))}onBeforeRender(e){let t=this.material.uniforms;t&&t.resolution&&(e.getViewport(Pe),this.material.uniforms.resolution.value.set(Pe.z,Pe.w))}},Ue=class extends He{constructor(e=new Me,t=new Ne({color:Math.random()*16777215})){super(e,t),this.isLine2=!0,this.type=`Line2`}},q=e(c()),We=q.forwardRef(function({points:e,color:t=16777215,vertexColors:n,linewidth:r,lineWidth:i,segments:a,dashed:o,...s},c){var l;let u=A(e=>e.size),ee=q.useMemo(()=>a?new He:new Ue,[a]),[d]=q.useState(()=>new Ne),f=(n==null||(l=n[0])==null?void 0:l.length)===4?4:3,p=q.useMemo(()=>{let r=a?new I:new Me,i=e.map(e=>{let t=Array.isArray(e);return e instanceof g||e instanceof v?[e.x,e.y,e.z]:e instanceof D?[e.x,e.y,0]:t&&e.length===3?[e[0],e[1],e[2]]:t&&e.length===2?[e[0],e[1],0]:e});if(r.setPositions(i.flat()),n){t=16777215;let e=n.map(e=>e instanceof k?e.toArray():e);r.setColors(e.flat(),f)}return r},[e,a,n,f]);return q.useLayoutEffect(()=>{ee.computeLineDistances()},[e,ee]),q.useLayoutEffect(()=>{o?d.defines.USE_DASH=``:delete d.defines.USE_DASH,d.needsUpdate=!0},[o,d]),q.useEffect(()=>()=>{p.dispose(),d.dispose()},[p]),q.createElement(`primitive`,j({object:ee,ref:c},s),q.createElement(`primitive`,{object:p,attach:`geometry`}),q.createElement(`primitive`,j({object:d,attach:`material`,color:t,vertexColors:!!n,resolution:[u.width,u.height],linewidth:r??i??1,dashed:o,transparent:f===4},s)))}),Ge=q.forwardRef(({threshold:e=15,geometry:t,...n},r)=>{let i=q.useRef(null);q.useImperativeHandle(r,()=>i.current,[]);let a=q.useMemo(()=>[0,0,0,1,0,0],[]),o=q.useRef(null),s=q.useRef(null);return q.useLayoutEffect(()=>{let n=i.current.parent,r=t??n?.geometry;if(!r||o.current===r&&s.current===e)return;o.current=r,s.current=e;let a=new ae(r,e).attributes.position.array;i.current.geometry.setPositions(a),i.current.geometry.attributes.instanceStart.needsUpdate=!0,i.current.geometry.attributes.instanceEnd.needsUpdate=!0,i.current.computeLineDistances()}),q.createElement(We,j({segments:!0,points:a,ref:i,raycast:()=>null},n))});function Ke(e,t){let n=e+`Geometry`;return q.forwardRef(({args:e,children:r,...i},a)=>{let o=q.useRef(null);return q.useImperativeHandle(a,()=>o.current),q.useLayoutEffect(()=>void t?.(o.current)),q.createElement(`mesh`,j({ref:o},i),q.createElement(n,{attach:`geometry`,args:e}),r)})}var qe=Ke(`box`),Je=a(`circle-check`,[[`circle`,{cx:`12`,cy:`12`,r:`10`,key:`1mglay`}],[`path`,{d:`m9 12 2 2 4-4`,key:`dzmm74`}]]),Ye=a(`circle-question-mark`,[[`circle`,{cx:`12`,cy:`12`,r:`10`,key:`1mglay`}],[`path`,{d:`M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3`,key:`1u773s`}],[`path`,{d:`M12 17h.01`,key:`p32p05`}]]),Xe=a(`circle`,[[`circle`,{cx:`12`,cy:`12`,r:`10`,key:`1mglay`}]]),Ze=a(`clipboard`,[[`rect`,{width:`8`,height:`4`,x:`8`,y:`2`,rx:`1`,ry:`1`,key:`tgr4d6`}],[`path`,{d:`M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2`,key:`116196`}]]),Qe=a(`crosshair`,[[`circle`,{cx:`12`,cy:`12`,r:`10`,key:`1mglay`}],[`line`,{x1:`22`,x2:`18`,y1:`12`,y2:`12`,key:`l9bcsi`}],[`line`,{x1:`6`,x2:`2`,y1:`12`,y2:`12`,key:`13hhkx`}],[`line`,{x1:`12`,x2:`12`,y1:`6`,y2:`2`,key:`10w3f3`}],[`line`,{x1:`12`,x2:`12`,y1:`22`,y2:`18`,key:`15g9kq`}]]),$e=a(`file-input`,[[`path`,{d:`M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4`,key:`1pf5j1`}],[`path`,{d:`M14 2v4a2 2 0 0 0 2 2h4`,key:`tnqrlb`}],[`path`,{d:`M2 15h10`,key:`jfw4w8`}],[`path`,{d:`m9 18 3-3-3-3`,key:`112psh`}]]),et=a(`focus`,[[`circle`,{cx:`12`,cy:`12`,r:`3`,key:`1v7zrd`}],[`path`,{d:`M3 7V5a2 2 0 0 1 2-2h2`,key:`aa7l1z`}],[`path`,{d:`M17 3h2a2 2 0 0 1 2 2v2`,key:`4qcy5o`}],[`path`,{d:`M21 17v2a2 2 0 0 1-2 2h-2`,key:`6vwrx8`}],[`path`,{d:`M7 21H5a2 2 0 0 1-2-2v-2`,key:`ioqczr`}]]),tt=a(`locate-fixed`,[[`line`,{x1:`2`,x2:`5`,y1:`12`,y2:`12`,key:`bvdh0s`}],[`line`,{x1:`19`,x2:`22`,y1:`12`,y2:`12`,key:`1tbv5k`}],[`line`,{x1:`12`,x2:`12`,y1:`2`,y2:`5`,key:`11lu5j`}],[`line`,{x1:`12`,x2:`12`,y1:`19`,y2:`22`,key:`x3vr5v`}],[`circle`,{cx:`12`,cy:`12`,r:`7`,key:`fim9np`}],[`circle`,{cx:`12`,cy:`12`,r:`3`,key:`1v7zrd`}]]),nt=a(`orbit`,[[`path`,{d:`M20.341 6.484A10 10 0 0 1 10.266 21.85`,key:`1enhxb`}],[`path`,{d:`M3.659 17.516A10 10 0 0 1 13.74 2.152`,key:`1crzgf`}],[`circle`,{cx:`12`,cy:`12`,r:`3`,key:`1v7zrd`}],[`circle`,{cx:`19`,cy:`5`,r:`2`,key:`mhkx31`}],[`circle`,{cx:`5`,cy:`19`,r:`2`,key:`v8kfzx`}]]),rt=a(`pen-line`,[[`path`,{d:`M13 21h8`,key:`1jsn5i`}],[`path`,{d:`M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z`,key:`1a8usu`}]]),it=a(`rotate-ccw`,[[`path`,{d:`M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8`,key:`1357e3`}],[`path`,{d:`M3 3v5h5`,key:`1xhq8a`}]]),at=a(`search`,[[`path`,{d:`m21 21-4.34-4.34`,key:`14j7rj`}],[`circle`,{cx:`11`,cy:`11`,r:`8`,key:`4ej97u`}]]),ot=a(`trash-2`,[[`path`,{d:`M10 11v6`,key:`nco0om`}],[`path`,{d:`M14 11v6`,key:`outv1u`}],[`path`,{d:`M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6`,key:`miytrc`}],[`path`,{d:`M3 6h18`,key:`d0wm0j`}],[`path`,{d:`M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2`,key:`e791ji`}]]),st=a(`undo-2`,[[`path`,{d:`M9 14 4 9l5-5`,key:`102s5s`}],[`path`,{d:`M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11`,key:`f3b9sd`}]]);t(((e,t)=>{t.exports={}}))();var ct=[`change`,`fix`,`remove`,`liked`],lt=1e6,ut=4e3;function dt(e){return typeof e==`object`&&!!e&&!Array.isArray(e)}function ft(e){return dt(e)&&[e.x,e.y,e.z].every(e=>typeof e==`number`&&Number.isSafeInteger(e))}function pt(e,t){return e.x>=t.min.x&&e.x<=t.max.x&&e.y>=t.min.y&&e.y<=t.max.y&&e.z>=t.min.z&&e.z<=t.max.z}function mt(e){return e.min.x<=e.max.x&&e.min.y<=e.max.y&&e.min.z<=e.max.z}function ht(e){return JSON.stringify(Object.entries(e??{}).sort(([e],[t])=>e.localeCompare(t)))}function gt(e){return dt(e)&&Object.keys(e).length<=64&&Object.entries(e).every(([e,t])=>e.length>0&&e.length<=100&&(typeof t==`boolean`||typeof t==`number`&&Number.isFinite(t)||typeof t==`string`&&t.length<=256))}function J(e){return typeof e==`string`&&e.length<=64&&Number.isFinite(Date.parse(e))}function Y(e){throw Error(`Invalid review: ${e}`)}function _t(e,t){return e.placements.reduce((e,n)=>e+ +!!pt(n,t),0)}function vt(e,t){let n=e.max.x-e.min.x+1,r=e.max.y-e.min.y+1,i=e.max.z-e.min.z+1,a=Math.max(0,n*r*i);return{width:n,height:r,depth:i,volume:a,blockCount:t,density:a?t/a:0}}function yt(e){let t=e.max.x-e.min.x,n=e.max.y-e.min.y,r=e.max.z-e.min.z;return{dx:t,dy:n,dz:r,horizontal:Math.hypot(t,r),direct:Math.hypot(t,n,r),manhattan:Math.abs(t)+Math.abs(n)+Math.abs(r)}}function bt(e){let t=e.trim(),n=t.match(/^(-?\d+)\s*(?:,|\s)\s*(-?\d+)\s*(?:,|\s)\s*(-?\d+)$/)??t.match(/^x\s*=\s*(-?\d+)\s*[,; ]+y\s*=\s*(-?\d+)\s*[,; ]+z\s*=\s*(-?\d+)$/i)??t.match(/^\/?tp\s+(?:@[pares](?:\[[^\]]*\])?\s+)?(-?\d+)\s+(-?\d+)\s+(-?\d+)$/i);if(!n)return;let[r,i,a]=n.slice(1).map(Number);return[r,i,a].every(Number.isSafeInteger)?{x:r,y:i,z:a}:void 0}function xt(e,t){let n=t.trim().toLowerCase().replace(/^minecraft:/,``);if(n.length<2)return{matches:[],capped:!1,tooShort:!!n};let r=[],i=!1;for(let t of e){let e=t.block.replace(`minecraft:`,``),a=Object.entries(t.state??{}).sort(([e],[t])=>e.localeCompare(t)).map(([e,t])=>`${e}=${String(t)}`).join(` `);if(`${e} ${e.replaceAll(`_`,` `)} ${t.phase} ${a}`.toLowerCase().includes(n)){if(r.length===500){i=!0;break}r.push(t)}}return{matches:r,capped:i,tooShort:!1}}function St(e,t){let n=typeof e.reviewBuildId==`string`,r=typeof e.reviewBuildHash==`string`;return!n&&!r?`unbound`:!n||!r?`different`:e.reviewBuildId===t.id&&e.reviewBuildHash===t.hash?`current`:`different`}function Ct(e,t){let n=`review_${(t??globalThis.crypto?.randomUUID?.()??`${Date.now().toString(36)}_${Math.random().toString(36).slice(2,12)}`).replace(/[^A-Za-z0-9._:]/g,`_`).slice(0,96)||`annotation`}`,r=new Set(e);if(!r.has(n))return n;let i=2;for(;r.has(`${n}_${i}`);)i+=1;return`${n}_${i}`}function wt(e,t,n){if(e.length>=500)return;let r=Ct(e.map(e=>e.id),n);return[{...t,id:r},...e]}function Tt(e,t){dt(e)||Y(`the JSON root must be an object.`),(e.type!==`blockwright-review`||e.schemaVersion!==1)&&Y(`unsupported type or schema version.`),(!dt(e.build)||e.build.hash!==t.hash)&&Y(`the immutable build hash does not match this build.`),(typeof e.build.id!=`string`||e.build.id!==t.id)&&Y(`the build id does not match this build.`),Array.isArray(e.annotations)||Y(`annotations must be an array.`),e.annotations.length>500&&Y(`at most 500 annotations may be imported at once.`),e.annotations.length*t.placements.length>12e6&&Y(`this annotation/build combination is too large to validate safely in the reviewer; split the review into smaller files.`);let n=new Set;return e.annotations.map((e,r)=>{let i=`annotation ${r+1}`;dt(e)||Y(`${i} must be an object.`),(typeof e.id!=`string`||!/^[A-Za-z0-9._:-]{1,128}$/.test(e.id))&&Y(`${i} has an invalid id.`),n.has(e.id)&&Y(`${i} repeats id ${e.id}.`),n.add(e.id),(typeof e.category!=`string`||!ct.includes(e.category))&&Y(`${i} has an unsupported category.`),(typeof e.note!=`string`||e.note.length>4e3)&&Y(`${i} has an invalid or oversized note.`),J(e.createdAt)||Y(`${i} has an invalid createdAt timestamp.`),e.updatedAt!==void 0&&!J(e.updatedAt)&&Y(`${i} has an invalid updatedAt timestamp.`),e.resolved!==void 0&&typeof e.resolved!=`boolean`&&Y(`${i} has an invalid resolved flag.`),(!dt(e.bounds)||!ft(e.bounds.min)||!ft(e.bounds.max))&&Y(`${i} bounds must contain exact integer coordinates.`);let a={min:{...e.bounds.min},max:{...e.bounds.max}};mt(a)||Y(`${i} bounds are reversed.`),(!pt(a.min,t.bounds)||!pt(a.max,t.bounds))&&Y(`${i} is outside the immutable build bounds.`);let o=_t(t,a);if((typeof e.blockCount!=`number`||!Number.isSafeInteger(e.blockCount)||e.blockCount!==o)&&Y(`${i} block count does not match the canonical build.`),e.pickedBlock!==void 0&&(typeof e.pickedBlock!=`string`||e.pickedBlock.length>200)&&Y(`${i} has an invalid picked block.`),e.pickedState!==void 0&&!gt(e.pickedState)&&Y(`${i} has an invalid picked state.`),e.pickedState!==void 0&&e.pickedBlock===void 0&&Y(`${i} has block state without a picked block.`),e.pickedBlock!==void 0){let n=e.pickedState===void 0?void 0:ht(e.pickedState);t.placements.some(t=>pt(t,a)&&t.block===e.pickedBlock&&(n===void 0||ht(t.state)===n))||Y(`${i} picked block or state is not canonical within its bounds.`)}return{id:e.id,category:e.category,note:e.note,bounds:a,blockCount:e.blockCount,...e.pickedBlock===void 0?{}:{pickedBlock:e.pickedBlock},...e.pickedState===void 0?{}:{pickedState:{...e.pickedState}},createdAt:e.createdAt,...e.resolved===void 0?{}:{resolved:e.resolved},...e.updatedAt===void 0?{}:{updatedAt:e.updatedAt}}})}function Et(e,t){let n=t?.input.rolePalette?.roof;return e.block===n||/roof|eave|ridge|gable|tile|finial|soffit/i.test(e.phase)||/roof_tile/.test(e.block)}var X=i(),Dt={change:`#e9ad4f`,fix:`#ef6b5b`,remove:`#c74f76`,liked:`#5ec6a7`},Z=({x:e,y:t,z:n})=>`${e},${t},${n}`,Ot=e=>e.replace(`minecraft:`,``).split(`_`).map(e=>e[0].toUpperCase()+e.slice(1)).join(` `),kt=e=>Object.entries(e??{}).sort(([e],[t])=>e.localeCompare(t)).map(([e,t])=>`${e}=${String(t)}`).join(`, `),At=(e,t)=>!!(e&&t&&e.x===t.x&&e.y===t.y&&e.z===t.z),jt=e=>({x:(e.min.x+e.max.x)/2,y:(e.min.y+e.max.y)/2,z:(e.min.z+e.max.z)/2}),Q=(e,t)=>String(e.state?.[t]??``),Mt=e=>({north:[0,-1],south:[0,1],west:[-1,0],east:[1,0]})[e]??[0,-1],Nt=e=>({north:0,east:-Math.PI/2,south:Math.PI,west:Math.PI/2})[e]??0;function Pt(e){return/lantern|glowstone|froglight|shroomlight/.test(e)?`#e9ad4f`:/deepslate|blackstone|coal/.test(e)?`#30383d`:/stone|tuff|andesite|cobble/.test(e)?`#747a78`:/mangrove|crimson|brick|terracotta/.test(e)?`#7d3428`:/spruce|dark_oak/.test(e)?`#49311f`:/oak|bamboo|birch/.test(e)?`#ad8250`:/glass|pane|ice/.test(e)?`#8fc4cc`:/moss|grass|leaves|vine/.test(e)?`#52724c`:`#9ba0a2`}function Ft(e){let t=e.block,n=Q(e,`facing`)||`north`,r=Q(e,`half`)||`bottom`,[i,a]=Mt(n);if(t.endsWith(`_slab`)){let t=Q(e,`type`)||`bottom`;return t===`double`?[{size:[1,1,1],offset:[0,0,0]}]:[{size:[1,.5,1],offset:[0,t===`top`?.25:-.25,0]}]}if(t.endsWith(`_stairs`)){let e=r===`top`;return[{size:[1,.5,1],offset:[0,e?.25:-.25,0]},{size:[Math.abs(i)?.5:1,.5,Math.abs(a)?.5:1],offset:[i*.25,e?-.25:.25,a*.25]}]}if(t.endsWith(`_trapdoor`))return Q(e,`open`)===`true`?[{size:[Math.abs(i)?.1875:1,1,Math.abs(a)?.1875:1],offset:[i*.40625,0,a*.40625]}]:[{size:[1,.1875,1],offset:[0,r===`top`?.40625:-.40625,0]}];if(/glass_pane|iron_bars/.test(t)){let t=[{size:[.125,1,.125],offset:[0,0,0]}];return Q(e,`north`)===`true`&&t.push({size:[.125,1,.5],offset:[0,0,-.25]}),Q(e,`south`)===`true`&&t.push({size:[.125,1,.5],offset:[0,0,.25]}),Q(e,`west`)===`true`&&t.push({size:[.5,1,.125],offset:[-.25,0,0]}),Q(e,`east`)===`true`&&t.push({size:[.5,1,.125],offset:[.25,0,0]}),t}if(/_fence$|_wall$/.test(t)){let t=[{size:[.25,1,.25],offset:[0,0,0]}],n=t=>[`true`,`low`,`tall`].includes(Q(e,t));return n(`north`)&&t.push({size:[.25,.5,.5],offset:[0,.05,-.25]}),n(`south`)&&t.push({size:[.25,.5,.5],offset:[0,.05,.25]}),n(`west`)&&t.push({size:[.5,.5,.25],offset:[-.25,.05,0]}),n(`east`)&&t.push({size:[.5,.5,.25],offset:[.25,.05,0]}),t}return/_door$/.test(t)&&!/_trapdoor$/.test(t)?[{size:[1,1,.1875],offset:[0,0,0],rotationY:Nt(n)}]:/(^|:)lantern$|soul_lantern$/.test(t)?[{size:[.5,.5,.5],offset:[0,-.05,0],role:`lantern`},{size:[.25,.18,.25],offset:[0,.29,0],role:`metal`},...Q(e,`hanging`)===`true`?[{size:[.12,.28,.12],offset:[0,.43,0],role:`metal`}]:[]]:[{size:[1,1,1],offset:[0,0,0]}]}function It(e){let t=(0,q.useMemo)(()=>{let t=new Map;if(!e)return t;let n=new ne;for(let r of e.textures.values())for(let e of Object.values(r)){if(t.has(e))continue;let r=n.load(e);r.colorSpace=M,r.magFilter=_,r.minFilter=y,t.set(e,r)}return t},[e]);return(0,q.useEffect)(()=>()=>{for(let e of t.values())e.dispose()},[t]),t}function Lt({placements:e,part:t,block:n,textures:r,textureMaps:i,dimmed:a,onPick:o}){let s=(0,q.useRef)(null),c=(0,q.useMemo)(()=>{let e=r?.top,o=e?i.get(e):void 0,s=t.role===`lantern`?new k(`#b86b22`):new k(`#000000`);return new te({color:e?`#ffffff`:t.role===`metal`?`#242a2c`:Pt(n),map:o,roughness:t.role===`metal`?.45:.88,metalness:t.role===`metal`?.5:0,transparent:a||/glass|pane|leaves/.test(n),opacity:a?.2:1,alphaTest:/glass|pane|leaves|door|trapdoor/.test(n)?.08:0,emissive:s,emissiveIntensity:t.role===`lantern`?1.1:0})},[n,a,t.role,i,r?.top]);return(0,q.useEffect)(()=>()=>{c.dispose()},[c]),(0,q.useEffect)(()=>{if(!s.current)return;let n=new ie,r=new C().setFromEuler(new h(0,t.rotationY??0,0));e.forEach((e,i)=>{n.compose(new g(e.x+t.offset[0],e.y+t.offset[1],e.z+t.offset[2]),r,new g(...t.size)),s.current.setMatrixAt(i,n)}),s.current.instanceMatrix.needsUpdate=!0},[e,t]),(0,X.jsx)(`instancedMesh`,{ref:s,args:[void 0,void 0,e.length],material:c,frustumCulled:!1,onClick:t=>{t.stopPropagation(),t.instanceId!==void 0&&o(e[t.instanceId])},children:(0,X.jsx)(`boxGeometry`,{args:[1,1,1]})})}function Rt({selection:e,color:t=`#f2b661`}){if(!e)return null;let n=[e.max.x-e.min.x+1.08,e.max.y-e.min.y+1.08,e.max.z-e.min.z+1.08],r=[(e.min.x+e.max.x)/2,(e.min.y+e.max.y)/2,(e.min.z+e.max.z)/2];return(0,X.jsxs)(qe,{args:n,position:r,children:[(0,X.jsx)(`meshBasicMaterial`,{transparent:!0,opacity:.035,color:t,depthWrite:!1}),(0,X.jsx)(Ge,{color:t})]})}function zt({build:e,maxLayer:t,hideRoof:n,cameraPreset:r,cameraTarget:i,cameraDistance:a,orthographic:o,selection:s,annotations:c,texturePack:l,onPick:u}){let ee=It(l),d=(0,q.useMemo)(()=>{let r=new Map;for(let i of e.placements){if(i.y>t||n&&Et(i,e))continue;let a=Oe(i.block,i.state),o=r.get(a)??{placement:i,placements:[],parts:Ft(i)};o.placements.push(i),r.set(a,o)}return[...r.entries()]},[e,n,t]),f=[(e.bounds.min.x+e.bounds.max.x)/2,(e.bounds.min.y+e.bounds.max.y)/2,(e.bounds.min.z+e.bounds.max.z)/2],p=i?[i.x,i.y,i.z]:f,m=Math.max(e.bounds.dimensions.width,e.bounds.dimensions.depth,e.bounds.dimensions.height)*1.35,h=Math.max(6,Math.min(m,a??m)),te=`${r}-${Z({x:p[0],y:p[1],z:p[2]})}-${h.toFixed(2)}`,g={iso:[p[0]+h,p[1]+h*.65,p[2]-h],top:[p[0],p[1]+h*1.6,p[2]+.01],north:[p[0],p[1]+h*.3,p[2]-h*1.3],south:[p[0],p[1]+h*.3,p[2]+h*1.3],east:[p[0]+h*1.3,p[1]+h*.3,p[2]],west:[p[0]-h*1.3,p[1]+h*.3,p[2]]};return(0,X.jsxs)(se,{shadows:!0,dpr:[1,1.5],gl:{antialias:!0,alpha:!1},onPointerMissed:()=>void 0,children:[(0,X.jsx)(`color`,{attach:`background`,args:[`#06141e`]}),o?(0,X.jsx)(Ee,{makeDefault:!0,position:g[r],zoom:Math.max(4,850/h),onUpdate:e=>e.lookAt(...p)},`review-ortho-${te}`):(0,X.jsx)(O,{makeDefault:!0,position:g[r],fov:42,onUpdate:e=>e.lookAt(...p)},`review-perspective-${te}`),(0,X.jsx)(`ambientLight`,{intensity:1.05,color:`#a8bfd0`}),(0,X.jsx)(`directionalLight`,{position:[p[0]+h,p[1]+h,p[2]-h],intensity:2.2,color:`#f5e7cf`,castShadow:!0}),d.flatMap(([e,t])=>t.parts.map((n,r)=>(0,X.jsx)(Lt,{placements:t.placements,part:n,block:t.placement.block,textures:l?.textures.get(e),textureMaps:ee,dimmed:!1,onPick:u},`${e}-${r}`))),(0,X.jsx)(Rt,{selection:s}),c.map(e=>(0,X.jsx)(Rt,{selection:e.bounds,color:e.resolved?`#536b76`:Dt[e.category]},e.id)),(0,X.jsx)(fe,{position:[f[0],e.bounds.min.y-.51,f[2]],args:[Math.max(64,m*2),Math.max(64,m*2)],cellSize:1,cellColor:`#294554`,sectionSize:5,sectionColor:`#3f6170`,fadeDistance:m*1.8,infiniteGrid:!0}),(0,X.jsx)(de,{makeDefault:!0,target:p,minDistance:2,maxDistance:m*4,maxPolarAngle:Math.PI/2.01,enabled:!0})]})}function Bt(e,t){return{min:{x:Math.min(e.x,t.x),y:Math.min(e.y,t.y),z:Math.min(e.z,t.z)},max:{x:Math.max(e.x,t.x),y:Math.max(e.y,t.y),z:Math.max(e.z,t.z)}}}function $({label:e,shortcut:t,active:n,disabled:r,onClick:i,children:a}){let o=t?`${e} (${t})`:e;return(0,X.jsx)(`button`,{type:`button`,className:`review-icon-button ${n?`active`:``}`,"aria-label":o,"aria-pressed":n===void 0?void 0:n,title:o,disabled:r,onClick:i,children:a})}function Vt(e){return{reviewBuildId:e?.id,reviewBuildHash:e?.hash,mode:`orbit`,layer:e?.bounds.max.y??0,hideRoof:!1,orthographic:!1,cameraPreset:`iso`,cameraTarget:void 0,cameraDistance:void 0,annotations:[],selection:void 0,anchor:void 0,searchQuery:``,searchCursor:-1,auditQuery:``,auditSeverity:`all`,annotationQuery:``,annotationCategory:`all`,annotationStatus:`all`,focusedFindingCode:void 0,focusedFindingIndex:void 0}}function Ht(){let{output:e,isPending:t,responseMetadata:n}=s(),[i,a]=o(),{maxHeight:c}=r(),{download:d}=re(),f=n,p=we(f?.buildSummary,f?.buildPage,f?.build),m=p.build,h=f?.audit,te=e?.review,g=(m??f?.buildSummary)?.bounds.max.y??0,ne=(m??f?.buildSummary)?.bounds.min.y??0,[_,v]=u(Vt(m)),y=(m?St(_,m):`unbound`)===`current`?_:Vt(m),b=y.mode??`orbit`,ie=y.layer??g,x=y.hideRoof??!1,S=y.orthographic??!1,C=y.cameraPreset??`iso`,w=y.cameraTarget,ae=y.cameraDistance,T=Array.isArray(y.annotations)?y.annotations:[],E=y.selection,D=y.anchor,O=y.searchQuery??``,se=y.auditQuery??``,de=y.auditSeverity??`all`,fe=y.annotationQuery??``,me=y.annotationCategory??`all`,he=y.annotationStatus??`all`,[xe,Ee]=(0,q.useState)(`fix`),[k,A]=(0,q.useState)(``),[j,M]=(0,q.useState)(),[Oe,je]=(0,q.useState)(),[N,P]=(0,q.useState)(),[F,I]=(0,q.useState)(!1),[Me,Ne]=(0,q.useState)(null),[Pe,Fe]=(0,q.useState)(`Procedural fallback`),Ie=(0,q.useRef)(null),L=(0,q.useRef)(null),R=(0,q.useRef)(null),z=m?`${m.id}:${m.hash}`:``,B=(0,q.useRef)(z);B.current=z;let Le=(0,q.useMemo)(()=>{let e=new Map;for(let t of m?.placements??[])e.set(Z(t),t);return e},[m]),V=(0,q.useMemo)(()=>m?.placements.reduce((e,t)=>e+ +(t.y<=ie&&(!x||!Et(t,m))),0)??0,[m,x,ie]),Re=(0,q.useMemo)(()=>!m||bt(O)?{matches:[],capped:!1,tooShort:!1}:xt(m.placements,O),[m,O]),H=Re.matches,U=(0,q.useMemo)(()=>{if(!h)return[];let e=se.trim().toLowerCase();return h.findings.filter(t=>(de===`all`||t.severity===de)&&(!e||`${t.code.replaceAll(`_`,` `)} ${t.message} ${t.coordinates.map(Z).join(` `)}`.toLowerCase().includes(e)))},[h,se,de]),W=(0,q.useMemo)(()=>U.flatMap(e=>e.coordinates.map((t,n)=>({finding:e,coordinate:t,coordinateIndex:n}))),[U]),G=(0,q.useMemo)(()=>{let e=fe.trim().toLowerCase();return T.filter(t=>(me===`all`||t.category===me)&&(he===`all`||he===`resolved`==!!t.resolved)&&(!e||`${t.category} ${t.note} ${t.pickedBlock??``} ${Z(t.bounds.min)} ${Z(t.bounds.max)}`.toLowerCase().includes(e)))},[me,fe,he,T]);if((0,q.useEffect)(()=>{if(!m)return;let e=St(_,m);if(e===`different`){v(Vt(m)),Ee(`fix`),A(``),M(void 0),je(void 0),I(!1),Ne(null),Fe(`Procedural fallback`),P({kind:`info`,message:`Build changed; previous build-bound review state was cleared.`});return}if(e===`unbound`){let e=[],t=Array.isArray(_.annotations)?_.annotations:[];try{e=Tt({schemaVersion:1,type:`blockwright-review`,build:{id:m.id,hash:m.hash},annotations:t},m)}catch{}v({...Vt(m),annotations:e}),t.length&&!e.length&&P({kind:`info`,message:`Older saved annotations could not be verified for this build and were cleared.`});return}let t=Array.isArray(_.annotations)?_.annotations:[],n=t.length>500?t.slice(0,500):t,r=typeof _.layer==`number`&&_.layer>=m.bounds.min.y&&_.layer<=m.bounds.max.y?_.layer:m.bounds.max.y;(n!==_.annotations||r!==_.layer)&&(v(e=>({...e,layer:r,annotations:n})),t.length>500&&P({kind:`info`,message:`Saved review state was repaired to the 500-annotation limit.`}))},[m?.hash,m?.id,_.annotations?.length,_.reviewBuildHash,_.reviewBuildId]),(0,q.useEffect)(()=>()=>Me?.dispose(),[Me]),(0,q.useEffect)(()=>{if(i!==`fullscreen`)return;let e=e=>{let t=e.target?.matches(`input, textarea, select, [contenteditable='true']`);if(e.key===`Escape`){F?I(!1):(M(void 0),A(``),v(e=>({...e,anchor:void 0,selection:void 0})));return}if(t)return;let n=e.key.toLowerCase(),r={o:`orbit`,b:`select`,r:`region`,m:`measure`},i={1:`iso`,2:`top`,3:`north`,4:`south`,5:`east`,6:`west`};r[n]?(e.preventDefault(),v(e=>({...e,mode:r[n],anchor:void 0}))):i[n]?(e.preventDefault(),v(e=>({...e,cameraPreset:i[n]}))):n===`0`?(e.preventDefault(),v(e=>({...e,cameraTarget:void 0,cameraDistance:void 0}))):n===`p`?(e.preventDefault(),v(e=>({...e,orthographic:!e.orthographic}))):n===`h`?(e.preventDefault(),v(e=>({...e,hideRoof:!e.hideRoof}))):e.key===`[`?(e.preventDefault(),v(e=>({...e,layer:Math.max(ne,(e.layer??g)-1)}))):e.key===`]`?(e.preventDefault(),v(e=>({...e,layer:Math.min(g,(e.layer??g)+1)}))):e.key===`?`||e.key===`/`&&e.shiftKey?(e.preventDefault(),I(e=>!e)):e.key===`/`&&(e.preventDefault(),R.current?.focus())};return window.addEventListener(`keydown`,e),()=>window.removeEventListener(`keydown`,e)},[i,g,ne,F]),!t&&f?.buildSummary&&p.error)return(0,X.jsxs)(`div`,{className:`loading-view`,children:[(0,X.jsx)(Se,{size:34}),(0,X.jsxs)(`span`,{children:[`Exact review blocks could not be loaded. `,p.error]})]});if(t||!m||!te||!h)return(0,X.jsxs)(`div`,{className:`loading-view`,children:[(0,X.jsx)(_e,{size:34}),(0,X.jsx)(`span`,{children:f?.buildSummary?`Loading exact review blocks… ${p.loaded.toLocaleString()} / ${p.total.toLocaleString()}`:`Preparing exact 3D review…`})]});let K=e=>{let t={x:e.x,y:e.y,z:e.z};return{...Bt(t,t),type:`block`,blockCount:1,pickedBlock:e.block,pickedState:e.state,pickedPhase:e.phase}},ze=e=>{let t=vt(e,0);v(n=>({...n,cameraTarget:jt(e),cameraDistance:Math.max(6,Math.max(t.width,t.height,t.depth)*2.1),layer:Math.max(ne,Math.min(g,e.max.y))}))},Be=(e,t)=>{let n={x:e.x,y:e.y,z:e.z};v(r=>({...r,mode:`select`,selection:K(e),anchor:void 0,layer:n.y,hideRoof:!Et(e,m)&&r.hideRoof,cameraTarget:n,cameraDistance:8,focusedFindingCode:t?.code,focusedFindingIndex:t?.coordinateIndex}))},Ve=e=>{let t=Le.get(Z(e.coordinate));if(!t){P({kind:`error`,message:`Audit coordinate ${Z(e.coordinate)} is not present in the immutable build.`});return}Be(t,{code:e.finding.code,coordinateIndex:e.coordinateIndex}),P({kind:`info`,message:`${e.finding.code.replaceAll(`_`,` `)} · sample ${e.coordinateIndex+1} of ${e.finding.coordinates.length}`})},He=e=>{if(!W.length)return;let t=W.findIndex(e=>e.finding.code===y.focusedFindingCode&&e.coordinateIndex===y.focusedFindingIndex),n=t<0?e>0?0:W.length-1:(t+e+W.length)%W.length;Ve(W[n])},Ue=e=>{let t={x:e.x,y:e.y,z:e.z};if(b===`orbit`)return;if(b===`select`){v(t=>({...t,selection:K(e),anchor:void 0}));return}if(!D){v(e=>({...e,anchor:t,selection:void 0}));return}let n=Bt(D,t);v(t=>({...t,anchor:void 0,selection:{...n,type:b===`measure`?`measure`:`region`,blockCount:_t(m,n),pickedBlock:e.block,pickedState:e.state,pickedPhase:e.phase}}))},We=()=>{let e=k.trim();if(!E||E.type===`measure`||!e)return;if(!j&&T.length>=500){P({kind:`error`,message:`This review already has the maximum 500 annotations. Resolve, edit, or remove an existing note before adding another.`});return}let t=new Date().toISOString();if(j){if(!T.some(e=>e.id===j)){M(void 0),P({kind:`error`,message:`That annotation is no longer present; no changes were saved.`});return}v(n=>({...n,annotations:n.annotations.map(n=>n.id===j?{...n,category:xe,note:e,bounds:{min:E.min,max:E.max},blockCount:E.blockCount,pickedBlock:E.pickedBlock,pickedState:E.pickedState,updatedAt:t}:n),selection:void 0})),P({kind:`success`,message:`Annotation updated.`}),M(void 0),A(``);return}let n=globalThis.crypto?.randomUUID?.()??`${Date.now().toString(36)}_${Math.random().toString(36).slice(2,12)}`,r={category:xe,note:e,bounds:{min:E.min,max:E.max},blockCount:E.blockCount,pickedBlock:E.pickedBlock,pickedState:E.pickedState,createdAt:t};v(e=>{let t=wt(Array.isArray(e.annotations)?e.annotations:[],r,n);return t?{...e,annotations:t,selection:void 0}:e}),A(``),P({kind:`success`,message:`Annotation saved to exact coordinates.`})},Ge=e=>{Ee(e.category),A(e.note),M(e.id);let t=m.placements.find(t=>t.x>=e.bounds.min.x&&t.x<=e.bounds.max.x&&t.y>=e.bounds.min.y&&t.y<=e.bounds.max.y&&t.z>=e.bounds.min.z&&t.z<=e.bounds.max.z&&(!e.pickedBlock||t.block===e.pickedBlock));v(n=>({...n,selection:{...e.bounds,type:e.bounds.min.x===e.bounds.max.x&&e.bounds.min.y===e.bounds.max.y&&e.bounds.min.z===e.bounds.max.z?`block`:`region`,blockCount:e.blockCount,pickedBlock:e.pickedBlock,pickedState:e.pickedState,pickedPhase:t?.phase},anchor:void 0})),ze(e.bounds),P({kind:`info`,message:`Editing annotation; save to apply changes.`})},Ke=e=>{let t=T.findIndex(t=>t.id===e.id);je({annotation:e,index:Math.max(0,t)}),v(t=>({...t,annotations:t.annotations.filter(t=>t.id!==e.id)})),j===e.id&&(M(void 0),A(``)),P({kind:`info`,message:`Annotation removed. Undo is available.`})},qe=()=>{Oe&&(v(e=>{if(e.annotations.some(e=>e.id===Oe.annotation.id)||e.annotations.length>=500)return e;let t=[...e.annotations];return t.splice(Math.min(Oe.index,t.length),0,Oe.annotation),{...e,annotations:t}}),je(void 0),P({kind:`success`,message:`Annotation restored.`}))},dt=e=>{let t=!e.resolved;v(n=>({...n,annotations:n.annotations.map(n=>n.id===e.id?{...n,resolved:t,updatedAt:new Date().toISOString()}:n)})),P({kind:`success`,message:t?`Annotation marked resolved.`:`Annotation reopened.`})},ft=async()=>{let e=z,t=m.input.name.toLowerCase().replace(/[^a-z0-9]+/g,`-`).replace(/^-|-$/g,``)||`blockwright-build`,n={schemaVersion:1,type:`blockwright-review`,build:{id:m.id,hash:m.hash,name:m.input.name,edition:m.input.edition,version:m.input.version,bounds:m.bounds},annotations:T,audit:h,viewer:{mode:b,layer:ie,hideRoof:x,orthographic:S,cameraPreset:C,cameraTarget:w,cameraDistance:ae},exportedAt:new Date().toISOString()};try{Tt(n,m);let r=JSON.stringify(n,null,2);if(new TextEncoder().encode(r).byteLength>1e6)throw Error(`This review exceeds the ${Math.round(lt/1e3)} KB import limit. Shorten or remove annotations before exporting.`);if(B.current!==e)throw Error(`The build changed before export completed. Export the newly opened review instead.`);let i=await d({contents:[{type:`resource`,resource:{uri:`file:///${t}-review.json`,mimeType:`application/json`,text:r}}]});if(B.current!==e)return;P(i.isError?{kind:`info`,message:`Review export was canceled or unavailable.`}:{kind:`success`,message:`Exported ${T.length} annotations for build ${m.hash.slice(0,12)}.`})}catch(e){P({kind:`error`,message:e instanceof Error?e.message:`Could not export this review.`})}},pt=async e=>{if(!e)return;let t=z;try{if(e.size>1e6)throw Error(`Review files must be ${Math.round(lt/1e3)} KB or smaller.`);if(!e.name.toLowerCase().endsWith(`.json`))throw Error(`Choose a Blockwright review JSON file.`);let n=await e.text();if(B.current!==t)throw Error(`The build changed while the review file was being read. Choose the file again for the current build.`);let r=Tt(JSON.parse(n),m);v(e=>St(e,m)===`current`?{...e,annotations:r}:e),M(void 0),je(void 0),A(``),P({kind:`success`,message:`Imported ${r.length} validated annotation${r.length===1?``:`s`}; build hash matched.`})}catch(e){P({kind:`error`,message:e instanceof Error?e.message:`Could not import this review.`})}},mt=async e=>{if(!e)return;let t=z;Fe(`Reading ${e.name}…`);try{let n=await Ae(e,m.placements);if(B.current!==t){n.dispose();return}Ne(e=>(e?.dispose(),n)),Fe(`${n.name} · ${n.resolved}/${n.requested} states resolved`),P({kind:`success`,message:`${n.resolved} of ${n.requested} material states resolved from ${n.name}.`})}catch(e){Fe(e instanceof Error?e.message:`Could not read this resource pack.`),P({kind:`error`,message:e instanceof Error?e.message:`Could not read this resource pack.`})}},ht=()=>{let e=bt(O);if(e){let t=Le.get(Z(e));if(!t){P({kind:`error`,message:`No canonical block exists at ${Z(e)}.`});return}Be(t),P({kind:`success`,message:`Focused ${t.block} at ${Z(t)}.`});return}if(!H.length){let e=O.trim();P({kind:`error`,message:Re.tooShort?`Use at least 2 characters for block, phase, or state search; exact coordinates are always accepted.`:e?`No block, phase, or state matches “${e}”.`:`Enter coordinates, a block, phase, or state.`});return}let t=((y.searchCursor??-1)+1)%H.length,n=H[t];Be(n),v(e=>({...e,searchCursor:t})),P({kind:`success`,message:`Match ${t+1} of ${H.length}${Re.capped?`+ capped results`:``}: ${n.block} at ${Z(n)}.`})},gt=async(e,t)=>{try{if(!navigator.clipboard?.writeText)throw Error(`Clipboard access is unavailable in this host.`);await navigator.clipboard.writeText(e),P({kind:`success`,message:`${t} copied.`})}catch(e){P({kind:`error`,message:e instanceof Error?e.message:`Could not copy to the clipboard.`})}},J=E?vt(E,E.blockCount):void 0,Y=E?.type===`measure`?yt(E):void 0,Ct=E?.pickedState?kt(E.pickedState):``,Q=Math.max(ne,Math.min(ie,g)),Mt=T.filter(e=>!e.resolved).length,Nt=h.findings.find(e=>e.code===y.focusedFindingCode),Pt=`Reviewing ${m.input.name}, immutable hash ${m.hash.slice(0,12)}. ${V} of ${m.placements.length} blocks visible through Y ${Q}; ${x?`roof hidden`:`roof visible`}. Camera ${C} ${S?`orthographic`:`perspective`}${w?` focused at ${Z(w)}`:` framed on the full build`}. ${T.length} annotations: ${Mt} open and ${T.length-Mt} resolved. ${E?`Selected ${E.type} from ${Z(E.min)} to ${Z(E.max)}${E.pickedBlock?`; canonical block ${E.pickedBlock}${Ct?` with state ${Ct}`:``}`:``}.`:`No selection.`} ${Nt?`Current audit finding ${Nt.code}, sample ${(y.focusedFindingIndex??0)+1}.`:``} Global audit: ${h.totals.errors} errors and ${h.totals.warnings} warnings across ${h.scannedPlacements} placements.`;return i===`fullscreen`?(0,X.jsx)(ee,{content:Pt,children:(0,X.jsxs)(`main`,{className:`review-shell`,style:{maxHeight:c||void 0},children:[(0,X.jsxs)(`header`,{className:`review-header`,children:[(0,X.jsxs)(`div`,{children:[(0,X.jsx)(`span`,{className:`panel-kicker`,children:`Blockwright reviewer`}),(0,X.jsx)(`h1`,{children:m.input.name})]}),(0,X.jsxs)(`div`,{className:`review-header-actions`,children:[(0,X.jsxs)(`button`,{onClick:()=>L.current?.click(),children:[(0,X.jsx)(ke,{size:15}),`Textures`]}),(0,X.jsxs)(`button`,{onClick:()=>Ie.current?.click(),children:[(0,X.jsx)($e,{size:15}),`Import review`]}),(0,X.jsxs)(`button`,{className:`primary-button`,onClick:()=>void ft(),children:[(0,X.jsx)(ge,{size:15}),`Export review`]}),(0,X.jsx)($,{label:`Collapse reviewer`,onClick:()=>a(`inline`),children:(0,X.jsx)(l,{size:16})})]}),(0,X.jsx)(`input`,{ref:L,hidden:!0,type:`file`,accept:`.zip,.jar,application/zip,application/java-archive`,onChange:e=>void mt(e.target.files?.[0])}),(0,X.jsx)(`input`,{ref:Ie,hidden:!0,type:`file`,accept:`.json,application/json`,onChange:e=>{let t=e.currentTarget.files?.[0];e.currentTarget.value=``,pt(t)}})]}),(0,X.jsxs)(`aside`,{className:`review-tools`,"aria-label":`Review tools`,children:[(0,X.jsx)($,{label:`Orbit`,shortcut:`O`,active:b===`orbit`,onClick:()=>v(e=>({...e,mode:`orbit`,anchor:void 0})),children:(0,X.jsx)(nt,{size:19})}),(0,X.jsx)($,{label:`Select block`,shortcut:`B`,active:b===`select`,onClick:()=>v(e=>({...e,mode:`select`,anchor:void 0})),children:(0,X.jsx)(ye,{size:19})}),(0,X.jsx)($,{label:`Select region`,shortcut:`R`,active:b===`region`,onClick:()=>v(e=>({...e,mode:`region`,anchor:void 0})),children:(0,X.jsx)(pe,{size:19})}),(0,X.jsx)($,{label:`Measure`,shortcut:`M`,active:b===`measure`,onClick:()=>v(e=>({...e,mode:`measure`,anchor:void 0})),children:(0,X.jsx)(oe,{size:19})}),(0,X.jsx)($,{label:`Frame whole build`,shortcut:`0`,active:!w,onClick:()=>v(e=>({...e,cameraTarget:void 0,cameraDistance:void 0})),children:(0,X.jsx)(et,{size:19})}),(0,X.jsx)(`span`,{className:`review-tools-spacer`}),(0,X.jsx)($,{label:`Isometric view`,shortcut:`1`,active:C===`iso`,onClick:()=>v(e=>({...e,cameraPreset:`iso`})),children:(0,X.jsx)(Qe,{size:19})}),(0,X.jsx)($,{label:`Top view`,shortcut:`2`,active:C===`top`,onClick:()=>v(e=>({...e,cameraPreset:`top`})),children:(0,X.jsx)(Te,{size:19})}),(0,X.jsx)($,{label:`North view`,shortcut:`3`,active:C===`north`,onClick:()=>v(e=>({...e,cameraPreset:`north`})),children:(0,X.jsx)(be,{size:19})}),(0,X.jsx)($,{label:`South view`,shortcut:`4`,active:C===`south`,onClick:()=>v(e=>({...e,cameraPreset:`south`})),children:(0,X.jsx)(Te,{size:19})}),(0,X.jsx)($,{label:`East view`,shortcut:`5`,active:C===`east`,onClick:()=>v(e=>({...e,cameraPreset:`east`})),children:(0,X.jsx)(le,{size:19})}),(0,X.jsx)($,{label:`West view`,shortcut:`6`,active:C===`west`,onClick:()=>v(e=>({...e,cameraPreset:`west`})),children:(0,X.jsx)(ue,{size:19})}),(0,X.jsx)($,{label:`Keyboard shortcuts`,shortcut:`?`,active:F,onClick:()=>I(e=>!e),children:(0,X.jsx)(Ye,{size:19})})]}),(0,X.jsxs)(`section`,{className:`review-viewport`,children:[(0,X.jsx)(zt,{build:m,maxLayer:Q,hideRoof:x,cameraPreset:C,cameraTarget:w,cameraDistance:ae,orthographic:S,selection:E,annotations:T,texturePack:Me,onPick:Ue}),(0,X.jsxs)(`form`,{className:`review-search`,role:`search`,onSubmit:e=>{e.preventDefault(),ht()},children:[(0,X.jsx)(at,{size:14,"aria-hidden":`true`}),(0,X.jsx)(`input`,{ref:R,"aria-label":`Find exact coordinates, block, phase, or state`,value:O,onChange:e=>v(t=>({...t,searchQuery:e.target.value,searchCursor:-1})),placeholder:`x,y,z or block / phase / state`}),O&&(0,X.jsx)(`button`,{type:`button`,"aria-label":`Clear search`,onClick:()=>v(e=>({...e,searchQuery:``,searchCursor:-1})),children:(0,X.jsx)(ve,{size:13})}),(0,X.jsxs)(`button`,{type:`submit`,children:[`Find`,H.length?` · ${H.length}${Re.capped?`+`:``}`:``]})]}),(0,X.jsxs)(`div`,{className:`review-view-switch`,"aria-label":`Camera projection`,children:[(0,X.jsx)(`button`,{type:`button`,"aria-pressed":!S,className:S?``:`active`,onClick:()=>v(e=>({...e,orthographic:!1})),children:`Perspective`}),(0,X.jsx)(`button`,{type:`button`,"aria-pressed":S,className:S?`active`:``,onClick:()=>v(e=>({...e,orthographic:!0})),children:`Orthographic`})]}),(0,X.jsxs)(`div`,{className:`review-viewport-status`,children:[(0,X.jsxs)(`span`,{children:[V.toLocaleString(),` / `,m.placements.length.toLocaleString(),` visible`]}),w&&(0,X.jsxs)(`span`,{children:[`Focus `,Z(w)]})]}),(0,X.jsxs)(`div`,{className:`review-layer-control`,children:[(0,X.jsx)(Ce,{size:15}),(0,X.jsx)(`input`,{"aria-label":`Maximum visible Y layer ${Q}`,type:`range`,min:ne,max:g,value:Q,onChange:e=>v(t=>({...t,layer:Number(e.target.value)}))}),(0,X.jsxs)(`strong`,{children:[`Y ≤ `,Q]}),(0,X.jsxs)(`label`,{children:[(0,X.jsx)(`input`,{type:`checkbox`,checked:x,onChange:e=>v(t=>({...t,hideRoof:e.target.checked}))}),`Hide roof `,(0,X.jsx)(`kbd`,{children:`H`})]})]}),D&&(0,X.jsxs)(`div`,{className:`review-instruction`,role:`status`,children:[`First corner: `,Z(D),` · choose the second point `,(0,X.jsx)(`button`,{type:`button`,onClick:()=>v(e=>({...e,anchor:void 0})),children:`Cancel`})]}),N&&(0,X.jsxs)(`div`,{className:`review-activity ${N.kind}`,role:N.kind===`error`?`alert`:`status`,"aria-live":`polite`,children:[N.kind===`error`?(0,X.jsx)(Se,{size:14}):N.kind===`success`?(0,X.jsx)(Je,{size:14}):(0,X.jsx)(ce,{size:14}),(0,X.jsx)(`span`,{children:N.message}),(0,X.jsx)(`button`,{type:`button`,"aria-label":`Dismiss message`,onClick:()=>P(void 0),children:(0,X.jsx)(ve,{size:13})})]}),F&&(0,X.jsxs)(`section`,{className:`review-shortcuts`,"aria-label":`Keyboard shortcuts`,children:[(0,X.jsxs)(`header`,{children:[(0,X.jsx)(`strong`,{children:`Keyboard shortcuts`}),(0,X.jsx)(`button`,{type:`button`,"aria-label":`Close keyboard shortcuts`,onClick:()=>I(!1),children:(0,X.jsx)(ve,{size:14})})]}),(0,X.jsxs)(`dl`,{children:[(0,X.jsxs)(`div`,{children:[(0,X.jsxs)(`dt`,{children:[(0,X.jsx)(`kbd`,{children:`O`}),` `,(0,X.jsx)(`kbd`,{children:`B`}),` `,(0,X.jsx)(`kbd`,{children:`R`}),` `,(0,X.jsx)(`kbd`,{children:`M`})]}),(0,X.jsx)(`dd`,{children:`Orbit, block, region, measure`})]}),(0,X.jsxs)(`div`,{children:[(0,X.jsxs)(`dt`,{children:[(0,X.jsx)(`kbd`,{children:`1`}),`–`,(0,X.jsx)(`kbd`,{children:`6`})]}),(0,X.jsx)(`dd`,{children:`Isometric, top, cardinal views`})]}),(0,X.jsxs)(`div`,{children:[(0,X.jsx)(`dt`,{children:(0,X.jsx)(`kbd`,{children:`0`})}),(0,X.jsx)(`dd`,{children:`Frame the whole build`})]}),(0,X.jsxs)(`div`,{children:[(0,X.jsxs)(`dt`,{children:[(0,X.jsx)(`kbd`,{children:`P`}),` `,(0,X.jsx)(`kbd`,{children:`H`})]}),(0,X.jsx)(`dd`,{children:`Projection and roof visibility`})]}),(0,X.jsxs)(`div`,{children:[(0,X.jsxs)(`dt`,{children:[(0,X.jsx)(`kbd`,{children:`[`}),` `,(0,X.jsx)(`kbd`,{children:`]`})]}),(0,X.jsx)(`dd`,{children:`Move the visible Y layer`})]}),(0,X.jsxs)(`div`,{children:[(0,X.jsxs)(`dt`,{children:[(0,X.jsx)(`kbd`,{children:`/`}),` `,(0,X.jsx)(`kbd`,{children:`?`})]}),(0,X.jsx)(`dd`,{children:`Search and shortcut help`})]}),(0,X.jsxs)(`div`,{children:[(0,X.jsx)(`dt`,{children:(0,X.jsx)(`kbd`,{children:`Esc`})}),(0,X.jsx)(`dd`,{children:`Cancel anchor or clear selection`})]}),(0,X.jsxs)(`div`,{children:[(0,X.jsxs)(`dt`,{children:[(0,X.jsx)(`kbd`,{children:`Ctrl`}),`+`,(0,X.jsx)(`kbd`,{children:`Enter`})]}),(0,X.jsx)(`dd`,{children:`Save the annotation draft`})]})]})]})]}),(0,X.jsxs)(`aside`,{className:`review-inspector`,"aria-label":`Build review inspector`,children:[(0,X.jsxs)(`section`,{children:[(0,X.jsxs)(`div`,{className:`review-section-heading`,children:[(0,X.jsx)(`span`,{className:`panel-kicker`,children:j?`Edit annotation`:`New annotation`}),j?(0,X.jsx)(`button`,{type:`button`,className:`review-text-button`,onClick:()=>{M(void 0),A(``)},children:`Cancel edit`}):(0,X.jsx)(`small`,{children:`exact world coordinates`})]}),(0,X.jsx)(`div`,{className:`review-category-row`,children:ct.map(e=>(0,X.jsx)(`button`,{type:`button`,"aria-pressed":xe===e,className:xe===e?`active`:``,style:{"--category":Dt[e]},onClick:()=>Ee(e),children:e},e))}),(0,X.jsxs)(`label`,{className:`review-field-label`,htmlFor:`review-annotation-note`,children:[`Actionable intent `,(0,X.jsxs)(`span`,{children:[k.length,`/`,ut]})]}),(0,X.jsx)(`textarea`,{id:`review-annotation-note`,maxLength:ut,value:k,onChange:e=>A(e.target.value),onKeyDown:e=>{e.key===`Enter`&&(e.ctrlKey||e.metaKey)&&(e.preventDefault(),We())},placeholder:`Describe the issue, intended rule, or detail to preserve…`}),(0,X.jsxs)(`button`,{type:`button`,className:`primary-button review-save`,disabled:!E||E.type===`measure`||!k.trim()||!j&&T.length>=500,onClick:We,children:[(0,X.jsx)(De,{size:15}),j?`Update annotation`:`Save annotation`]}),!j&&T.length>=500&&(0,X.jsxs)(`small`,{className:`review-help-text`,children:[`Annotation limit reached (`,500,`/`,500,`). Existing notes can still be edited or resolved.`]}),!E&&(0,X.jsx)(`small`,{className:`review-help-text`,children:`Select a block or region first. Measurements stay separate from annotations.`})]}),(0,X.jsxs)(`section`,{children:[(0,X.jsxs)(`div`,{className:`review-section-heading`,children:[(0,X.jsx)(`span`,{className:`panel-kicker`,children:`Selection`}),(0,X.jsx)(`small`,{children:E?.type??`none`})]}),E?(0,X.jsxs)(`div`,{className:`review-selection-card`,children:[(0,X.jsxs)(`div`,{className:`review-selection-title`,children:[(0,X.jsxs)(`strong`,{children:[E.blockCount.toLocaleString(),` occupied block`,E.blockCount===1?``:`s`]}),(0,X.jsx)(`button`,{type:`button`,title:`Frame selection`,"aria-label":`Frame selection`,onClick:()=>ze(E),children:(0,X.jsx)(tt,{size:14})})]}),(0,X.jsxs)(`span`,{children:[`Min `,(0,X.jsx)(`code`,{children:Z(E.min)})]}),(0,X.jsxs)(`span`,{children:[`Max `,(0,X.jsx)(`code`,{children:Z(E.max)})]}),J&&(0,X.jsxs)(`span`,{children:[`Inclusive size `,(0,X.jsxs)(`b`,{children:[J.width,` × `,J.height,` × `,J.depth]}),` · volume `,J.volume.toLocaleString()]}),J&&E.type!==`block`&&(0,X.jsxs)(`span`,{children:[`Occupancy `,(J.density*100).toFixed(1),`%`]}),E.pickedBlock&&(0,X.jsxs)(`span`,{className:`review-canonical`,children:[(0,X.jsx)(`b`,{children:Ot(E.pickedBlock)}),(0,X.jsx)(`code`,{children:E.pickedBlock})]}),E.pickedPhase&&(0,X.jsxs)(`span`,{children:[`Phase `,(0,X.jsx)(`b`,{children:E.pickedPhase})]}),Ct&&(0,X.jsx)(`code`,{children:Ct}),Y&&(0,X.jsxs)(`div`,{className:`review-measurements`,children:[(0,X.jsxs)(`span`,{children:[`Axis Δ `,(0,X.jsxs)(`b`,{children:[Y.dx,`, `,Y.dy,`, `,Y.dz]})]}),(0,X.jsxs)(`span`,{children:[`Horizontal `,(0,X.jsx)(`b`,{children:Y.horizontal.toFixed(2)})]}),(0,X.jsxs)(`span`,{children:[`Direct center-to-center `,(0,X.jsx)(`b`,{children:Y.direct.toFixed(2)})]}),(0,X.jsxs)(`span`,{children:[`Manhattan `,(0,X.jsx)(`b`,{children:Y.manhattan})]})]}),(0,X.jsxs)(`div`,{className:`review-copy-row`,children:[(0,X.jsxs)(`button`,{type:`button`,onClick:()=>void gt(Z(E.min),`Minimum coordinates`),children:[(0,X.jsx)(Ze,{size:12}),`Copy min`]}),(0,X.jsxs)(`button`,{type:`button`,onClick:()=>void gt(`/tp @s ${E.min.x} ${E.min.y} ${E.min.z}`,`Teleport command`),children:[(0,X.jsx)(Ze,{size:12}),`Copy /tp`]})]})]}):(0,X.jsx)(`p`,{className:`review-empty`,children:`Choose block or region select, then click the model.`})]}),(0,X.jsxs)(`section`,{children:[(0,X.jsxs)(`div`,{className:`review-section-heading`,children:[(0,X.jsx)(`span`,{className:`panel-kicker`,children:`Global audit`}),(0,X.jsxs)(`span`,{className:`review-heading-actions`,children:[(0,X.jsxs)(`small`,{children:[U.length,`/`,h.findings.length,` categories`]}),(0,X.jsx)($,{label:`Previous audit sample`,disabled:!W.length,onClick:()=>He(-1),children:(0,X.jsx)(ue,{size:14})}),(0,X.jsx)($,{label:`Next audit sample`,disabled:!W.length,onClick:()=>He(1),children:(0,X.jsx)(le,{size:14})})]})]}),(0,X.jsxs)(`div`,{className:`audit-totals`,children:[(0,X.jsxs)(`span`,{children:[(0,X.jsx)(`b`,{children:h.totals.errors}),` errors`]}),(0,X.jsxs)(`span`,{children:[(0,X.jsx)(`b`,{children:h.totals.warnings}),` warnings`]}),(0,X.jsxs)(`span`,{children:[(0,X.jsx)(`b`,{children:h.statefulPlacements.toLocaleString()}),` stateful`]})]}),(0,X.jsxs)(`div`,{className:`review-filter-row`,children:[(0,X.jsx)(at,{size:13}),(0,X.jsx)(`input`,{"aria-label":`Filter audit findings`,value:se,onChange:e=>v(t=>({...t,auditQuery:e.target.value,focusedFindingCode:void 0,focusedFindingIndex:void 0})),placeholder:`Filter code, message, coordinate`}),(0,X.jsxs)(`select`,{"aria-label":`Audit severity`,value:de,onChange:e=>v(t=>({...t,auditSeverity:e.target.value,focusedFindingCode:void 0,focusedFindingIndex:void 0})),children:[(0,X.jsx)(`option`,{value:`all`,children:`All severity`}),(0,X.jsx)(`option`,{value:`error`,children:`Errors`}),(0,X.jsx)(`option`,{value:`warning`,children:`Warnings`}),(0,X.jsx)(`option`,{value:`info`,children:`Info`})]})]}),(0,X.jsx)(`div`,{className:`audit-findings`,children:U.length?U.map(e=>(0,X.jsxs)(`article`,{className:y.focusedFindingCode===e.code?`active`:``,children:[(0,X.jsxs)(`button`,{type:`button`,className:`audit-finding-main`,disabled:!e.coordinates.length,onClick:()=>e.coordinates.length&&Ve({finding:e,coordinate:e.coordinates[0],coordinateIndex:0}),children:[(0,X.jsx)(`span`,{className:`audit-dot ${e.severity}`}),(0,X.jsxs)(`span`,{children:[(0,X.jsx)(`strong`,{children:e.code.replaceAll(`_`,` `)}),(0,X.jsxs)(`small`,{children:[e.total.toLocaleString(),` affected · `,e.coordinates.length.toLocaleString(),` sampled`]}),(0,X.jsx)(`small`,{children:e.message})]}),e.coordinates.length?(0,X.jsx)(tt,{size:13}):null]}),e.coordinates.length>0&&(0,X.jsxs)(`div`,{className:`audit-samples`,"aria-label":`${e.code} sampled coordinates`,children:[e.coordinates.slice(0,6).map((t,n)=>(0,X.jsx)(`button`,{type:`button`,className:y.focusedFindingCode===e.code&&y.focusedFindingIndex===n?`active`:``,onClick:()=>Ve({finding:e,coordinate:t,coordinateIndex:n}),children:Z(t)},Z(t))),e.coordinates.length>6&&(0,X.jsxs)(`span`,{children:[`+`,e.coordinates.length-6,` more via next`]})]})]},e.code)):h.findings.length?(0,X.jsx)(`p`,{className:`review-empty`,children:`No audit categories match these filters.`}):(0,X.jsxs)(`div`,{className:`review-pass`,children:[(0,X.jsx)(De,{size:16}),`No structural audit findings`]})})]}),(0,X.jsxs)(`section`,{className:`review-history-section`,children:[(0,X.jsxs)(`div`,{className:`review-section-heading`,children:[(0,X.jsx)(`span`,{className:`panel-kicker`,children:`Annotation history`}),(0,X.jsxs)(`span`,{className:`review-heading-actions`,children:[(0,X.jsxs)(`small`,{children:[Mt,` open · `,T.length-Mt,` resolved`]}),Oe&&(0,X.jsxs)(`button`,{type:`button`,className:`review-text-button`,onClick:qe,children:[(0,X.jsx)(st,{size:12}),`Undo`]})]})]}),(0,X.jsxs)(`div`,{className:`review-filter-row`,children:[(0,X.jsx)(at,{size:13}),(0,X.jsx)(`input`,{"aria-label":`Filter annotations`,value:fe,onChange:e=>v(t=>({...t,annotationQuery:e.target.value})),placeholder:`Filter notes, block, coordinate`}),(0,X.jsxs)(`select`,{"aria-label":`Annotation category`,value:me,onChange:e=>v(t=>({...t,annotationCategory:e.target.value})),children:[(0,X.jsx)(`option`,{value:`all`,children:`All categories`}),ct.map(e=>(0,X.jsx)(`option`,{value:e,children:e},e))]}),(0,X.jsxs)(`select`,{"aria-label":`Annotation status`,value:he,onChange:e=>v(t=>({...t,annotationStatus:e.target.value})),children:[(0,X.jsx)(`option`,{value:`all`,children:`All status`}),(0,X.jsx)(`option`,{value:`open`,children:`Open`}),(0,X.jsx)(`option`,{value:`resolved`,children:`Resolved`})]})]}),(0,X.jsx)(`div`,{className:`review-history`,children:G.length?G.map(e=>(0,X.jsxs)(`article`,{className:e.resolved?`resolved`:``,children:[(0,X.jsxs)(`button`,{type:`button`,className:`review-history-focus`,onClick:()=>{let t=e.pickedBlock?m.placements.find(t=>t.block===e.pickedBlock&&t.x>=e.bounds.min.x&&t.x<=e.bounds.max.x&&t.y>=e.bounds.min.y&&t.y<=e.bounds.max.y&&t.z>=e.bounds.min.z&&t.z<=e.bounds.max.z):void 0;v(n=>({...n,selection:{...e.bounds,type:e.bounds.min.x===e.bounds.max.x&&e.bounds.min.y===e.bounds.max.y&&e.bounds.min.z===e.bounds.max.z?`block`:`region`,blockCount:e.blockCount,pickedBlock:e.pickedBlock,pickedState:e.pickedState,pickedPhase:t?.phase},anchor:void 0})),ze(e.bounds)},children:[(0,X.jsx)(`i`,{style:{background:Dt[e.category]}}),(0,X.jsxs)(`span`,{children:[(0,X.jsxs)(`strong`,{children:[e.resolved?`Resolved · `:``,e.category,` · `,e.blockCount,` block`,e.blockCount===1?``:`s`]}),(0,X.jsx)(`small`,{children:e.note||Z(e.bounds.min)}),(0,X.jsxs)(`small`,{children:[Z(e.bounds.min),At(e.bounds.min,e.bounds.max)?``:` → ${Z(e.bounds.max)}`]})]})]}),(0,X.jsxs)(`div`,{className:`review-history-actions`,children:[(0,X.jsx)(`button`,{type:`button`,"aria-label":`Edit annotation ${e.note}`,title:`Edit annotation`,onClick:()=>Ge(e),children:(0,X.jsx)(rt,{size:13})}),(0,X.jsx)(`button`,{type:`button`,"aria-label":e.resolved?`Reopen annotation`:`Mark annotation resolved`,title:e.resolved?`Reopen`:`Mark resolved`,onClick:()=>dt(e),children:e.resolved?(0,X.jsx)(it,{size:13}):(0,X.jsx)(Xe,{size:13})}),(0,X.jsx)(`button`,{type:`button`,"aria-label":`Delete annotation ${e.note}`,title:`Delete annotation`,onClick:()=>Ke(e),children:(0,X.jsx)(ot,{size:13})})]})]},e.id)):T.length?(0,X.jsx)(`p`,{className:`review-empty`,children:`No annotations match these filters.`}):(0,X.jsx)(`p`,{className:`review-empty`,children:`No annotations yet.`})})]})]}),(0,X.jsxs)(`footer`,{className:`review-status`,children:[(0,X.jsxs)(`span`,{children:[(0,X.jsx)(`i`,{}),`Ready`]}),(0,X.jsx)(`span`,{children:b===`orbit`?`Orbit, pan, and zoom`:D?`Choose the second point`:`Review mode: ${b}`}),(0,X.jsx)(`span`,{children:Pe}),(0,X.jsxs)(`strong`,{children:[V.toLocaleString(),` visible · `,Mt,` open · `,m.hash.slice(0,8)]}),(0,X.jsx)(ce,{size:16})]})]})}):(0,X.jsx)(ee,{content:Pt,children:(0,X.jsxs)(`section`,{className:`inline-summary review-inline`,children:[(0,X.jsx)(`div`,{className:`brand-cube`,children:(0,X.jsx)(ce,{size:22})}),(0,X.jsxs)(`div`,{children:[(0,X.jsxs)(`h2`,{children:[`Review `,m.input.name]}),(0,X.jsxs)(`p`,{children:[m.placements.length.toLocaleString(),` exact blocks · `,h.findings.length,` audit categories · `,T.length,` annotations`]})]}),(0,X.jsxs)(`button`,{className:`primary-button`,onClick:()=>a(`fullscreen`),children:[(0,X.jsx)(l,{size:16}),`Open reviewer`]})]})})}n((0,q.createElement)(Ht));