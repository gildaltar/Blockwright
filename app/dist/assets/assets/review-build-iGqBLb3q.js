import{O as e}from"./v4-BJmWi5kg.js";import{a as t,c as n,d as r,i,l as a,n as o,p as s,r as c,s as l,u}from"./helpers-DGW9OV4V.js";import{A as ee,B as d,C as f,D as p,E as m,F as h,G as g,H as _,I as v,K as te,L as y,M as b,N as ne,O as x,P as S,R as C,S as w,T as re,U as T,V as E,W as D,_ as O,a as ie,b as ae,c as oe,d as se,f as ce,g as le,h as ue,i as de,j as fe,k as pe,l as me,m as he,n as ge,o as _e,p as ve,r as ye,s as be,t as xe,u as Se,v as Ce,w as k,x as A,y as j,z as M}from"./x-BY3pXkSl.js";import{i as we,n as Te,r as Ee,t as De}from"./resource-pack-DJL1oyVA.js";var N=parseInt(`179`.replace(/\D+/g,``)),P=N>=125?`uv1`:`uv2`,Oe=new A,F=new T,ke=class extends m{constructor(){super(),this.isLineSegmentsGeometry=!0,this.type=`LineSegmentsGeometry`,this.setIndex([0,2,1,2,3,1,2,4,3,4,5,3,4,6,5,6,7,5]),this.setAttribute(`position`,new re([-1,2,0,1,2,0,-1,1,0,1,1,0,-1,0,0,1,0,0,-1,-1,0,1,-1,0],3)),this.setAttribute(`uv`,new re([-1,2,1,2,-1,1,1,1,-1,-1,1,-1,-1,-2,1,-2],2))}applyMatrix4(e){let t=this.attributes.instanceStart,n=this.attributes.instanceEnd;return t!==void 0&&(t.applyMatrix4(e),n.applyMatrix4(e),t.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}setPositions(e){let t;e instanceof Float32Array?t=e:Array.isArray(e)&&(t=new Float32Array(e));let n=new p(t,6,1);return this.setAttribute(`instanceStart`,new x(n,3,0)),this.setAttribute(`instanceEnd`,new x(n,3,3)),this.computeBoundingBox(),this.computeBoundingSphere(),this}setColors(e,t=3){let n;e instanceof Float32Array?n=e:Array.isArray(e)&&(n=new Float32Array(e));let r=new p(n,t*2,1);return this.setAttribute(`instanceColorStart`,new x(r,t,0)),this.setAttribute(`instanceColorEnd`,new x(r,t,t)),this}fromWireframeGeometry(e){return this.setPositions(e.attributes.position.array),this}fromEdgesGeometry(e){return this.setPositions(e.attributes.position.array),this}fromMesh(e){return this.fromWireframeGeometry(new g(e.geometry)),this}fromLineSegments(e){let t=e.geometry;return this.setPositions(t.attributes.position.array),this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new A);let e=this.attributes.instanceStart,t=this.attributes.instanceEnd;e!==void 0&&t!==void 0&&(this.boundingBox.setFromBufferAttribute(e),Oe.setFromBufferAttribute(t),this.boundingBox.union(Oe))}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new M),this.boundingBox===null&&this.computeBoundingBox();let e=this.attributes.instanceStart,t=this.attributes.instanceEnd;if(e!==void 0&&t!==void 0){let n=this.boundingSphere.center;this.boundingBox.getCenter(n);let r=0;for(let i=0,a=e.count;i<a;i++)F.fromBufferAttribute(e,i),r=Math.max(r,n.distanceToSquared(F)),F.fromBufferAttribute(t,i),r=Math.max(r,n.distanceToSquared(F));this.boundingSphere.radius=Math.sqrt(r),isNaN(this.boundingSphere.radius)&&console.error(`THREE.LineSegmentsGeometry.computeBoundingSphere(): Computed radius is NaN. The instanced position data is likely to have NaN values.`,this)}}toJSON(){}applyMatrix(e){return console.warn(`THREE.LineSegmentsGeometry: applyMatrix() has been renamed to applyMatrix4().`),this.applyMatrix4(e)}},Ae=class extends ke{constructor(){super(),this.isLineGeometry=!0,this.type=`LineGeometry`}setPositions(e){let t=e.length-3,n=new Float32Array(2*t);for(let r=0;r<t;r+=3)n[2*r]=e[r],n[2*r+1]=e[r+1],n[2*r+2]=e[r+2],n[2*r+3]=e[r+3],n[2*r+4]=e[r+4],n[2*r+5]=e[r+5];return super.setPositions(n),this}setColors(e,t=3){let n=e.length-t,r=new Float32Array(2*n);if(t===3)for(let i=0;i<n;i+=t)r[2*i]=e[i],r[2*i+1]=e[i+1],r[2*i+2]=e[i+2],r[2*i+3]=e[i+3],r[2*i+4]=e[i+4],r[2*i+5]=e[i+5];else for(let i=0;i<n;i+=t)r[2*i]=e[i],r[2*i+1]=e[i+1],r[2*i+2]=e[i+2],r[2*i+3]=e[i+3],r[2*i+4]=e[i+4],r[2*i+5]=e[i+5],r[2*i+6]=e[i+6],r[2*i+7]=e[i+7];return super.setColors(r,t),this}fromLine(e){let t=e.geometry;return this.setPositions(t.attributes.position.array),this}},je=class extends C{constructor(e){super({type:`LineMaterial`,uniforms:E.clone(E.merge([ae.common,ae.fog,{worldUnits:{value:1},linewidth:{value:1},resolution:{value:new _(1,1)},dashOffset:{value:0},dashScale:{value:1},dashSize:{value:1},gapSize:{value:1}}])),vertexShader:`
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
					#include <${N>=154?`colorspace_fragment`:`encodings_fragment`}>
					#include <fog_fragment>
					#include <premultiplied_alpha_fragment>

				}
			`,clipping:!0}),this.isLineMaterial=!0,this.onBeforeCompile=function(){this.transparent?this.defines.USE_LINE_COLOR_ALPHA=`1`:delete this.defines.USE_LINE_COLOR_ALPHA},Object.defineProperties(this,{color:{enumerable:!0,get:function(){return this.uniforms.diffuse.value},set:function(e){this.uniforms.diffuse.value=e}},worldUnits:{enumerable:!0,get:function(){return`WORLD_UNITS`in this.defines},set:function(e){e===!0?this.defines.WORLD_UNITS=``:delete this.defines.WORLD_UNITS}},linewidth:{enumerable:!0,get:function(){return this.uniforms.linewidth.value},set:function(e){this.uniforms.linewidth.value=e}},dashed:{enumerable:!0,get:function(){return`USE_DASH`in this.defines},set(e){!!e!=`USE_DASH`in this.defines&&(this.needsUpdate=!0),e===!0?this.defines.USE_DASH=``:delete this.defines.USE_DASH}},dashScale:{enumerable:!0,get:function(){return this.uniforms.dashScale.value},set:function(e){this.uniforms.dashScale.value=e}},dashSize:{enumerable:!0,get:function(){return this.uniforms.dashSize.value},set:function(e){this.uniforms.dashSize.value=e}},dashOffset:{enumerable:!0,get:function(){return this.uniforms.dashOffset.value},set:function(e){this.uniforms.dashOffset.value=e}},gapSize:{enumerable:!0,get:function(){return this.uniforms.gapSize.value},set:function(e){this.uniforms.gapSize.value=e}},opacity:{enumerable:!0,get:function(){return this.uniforms.opacity.value},set:function(e){this.uniforms.opacity.value=e}},resolution:{enumerable:!0,get:function(){return this.uniforms.resolution.value},set:function(e){this.uniforms.resolution.value.copy(e)}},alphaToCoverage:{enumerable:!0,get:function(){return`USE_ALPHA_TO_COVERAGE`in this.defines},set:function(e){!!e!=`USE_ALPHA_TO_COVERAGE`in this.defines&&(this.needsUpdate=!0),e===!0?(this.defines.USE_ALPHA_TO_COVERAGE=``,this.extensions.derivatives=!0):(delete this.defines.USE_ALPHA_TO_COVERAGE,this.extensions.derivatives=!1)}}}),this.setValues(e)}},Me=new D,Ne=new T,Pe=new T,I=new D,L=new D,R=new D,Fe=new T,Ie=new fe,z=new pe,B=new T,V=new A,H=new M,U=new D,W,G;function Le(e,t,n){return U.set(0,0,-t,1).applyMatrix4(e.projectionMatrix),U.multiplyScalar(1/U.w),U.x=G/n.width,U.y=G/n.height,U.applyMatrix4(e.projectionMatrixInverse),U.multiplyScalar(1/U.w),Math.abs(Math.max(U.x,U.y))}function Re(e,t){let n=e.matrixWorld,r=e.geometry,i=r.attributes.instanceStart,a=r.attributes.instanceEnd,o=Math.min(r.instanceCount,i.count);for(let r=0,s=o;r<s;r++){z.start.fromBufferAttribute(i,r),z.end.fromBufferAttribute(a,r),z.applyMatrix4(n);let o=new T,s=new T;W.distanceSqToSegment(z.start,z.end,s,o),s.distanceTo(o)<G*.5&&t.push({point:s,pointOnLine:o,distance:W.origin.distanceTo(s),object:e,face:null,faceIndex:r,uv:null,[P]:null})}}function ze(e,t,n){let r=t.projectionMatrix,i=e.material.resolution,a=e.matrixWorld,o=e.geometry,s=o.attributes.instanceStart,c=o.attributes.instanceEnd,l=Math.min(o.instanceCount,s.count),u=-t.near;W.at(1,R),R.w=1,R.applyMatrix4(t.matrixWorldInverse),R.applyMatrix4(r),R.multiplyScalar(1/R.w),R.x*=i.x/2,R.y*=i.y/2,R.z=0,Fe.copy(R),Ie.multiplyMatrices(t.matrixWorldInverse,a);for(let t=0,o=l;t<o;t++){if(I.fromBufferAttribute(s,t),L.fromBufferAttribute(c,t),I.w=1,L.w=1,I.applyMatrix4(Ie),L.applyMatrix4(Ie),I.z>u&&L.z>u)continue;if(I.z>u){let e=I.z-L.z,t=(I.z-u)/e;I.lerp(L,t)}else if(L.z>u){let e=L.z-I.z,t=(L.z-u)/e;L.lerp(I,t)}I.applyMatrix4(r),L.applyMatrix4(r),I.multiplyScalar(1/I.w),L.multiplyScalar(1/L.w),I.x*=i.x/2,I.y*=i.y/2,L.x*=i.x/2,L.y*=i.y/2,z.start.copy(I),z.start.z=0,z.end.copy(L),z.end.z=0;let o=z.closestPointToPointParameter(Fe,!0);z.at(o,B);let l=ee.lerp(I.z,L.z,o),d=l>=-1&&l<=1,f=Fe.distanceTo(B)<G*.5;if(d&&f){z.start.fromBufferAttribute(s,t),z.end.fromBufferAttribute(c,t),z.start.applyMatrix4(a),z.end.applyMatrix4(a);let r=new T,i=new T;W.distanceSqToSegment(z.start,z.end,i,r),n.push({point:i,pointOnLine:r,distance:W.origin.distanceTo(i),object:e,face:null,faceIndex:t,uv:null,[P]:null})}}}var Be=class extends b{constructor(e=new ke,t=new je({color:Math.random()*16777215})){super(e,t),this.isLineSegments2=!0,this.type=`LineSegments2`}computeLineDistances(){let e=this.geometry,t=e.attributes.instanceStart,n=e.attributes.instanceEnd,r=new Float32Array(2*t.count);for(let e=0,i=0,a=t.count;e<a;e++,i+=2)Ne.fromBufferAttribute(t,e),Pe.fromBufferAttribute(n,e),r[i]=i===0?0:r[i-1],r[i+1]=r[i]+Ne.distanceTo(Pe);let i=new p(r,2,1);return e.setAttribute(`instanceDistanceStart`,new x(i,1,0)),e.setAttribute(`instanceDistanceEnd`,new x(i,1,1)),this}raycast(e,t){let n=this.material.worldUnits,r=e.camera;r===null&&!n&&console.error(`LineSegments2: "Raycaster.camera" needs to be set in order to raycast against LineSegments2 while worldUnits is set to false.`);let i=e.params.Line2===void 0?0:e.params.Line2.threshold||0;W=e.ray;let a=this.matrixWorld,o=this.geometry,s=this.material;G=s.linewidth+i,o.boundingSphere===null&&o.computeBoundingSphere(),H.copy(o.boundingSphere).applyMatrix4(a);let c;if(c=n?G*.5:Le(r,Math.max(r.near,H.distanceToPoint(W.origin)),s.resolution),H.radius+=c,W.intersectsSphere(H)===!1)return;o.boundingBox===null&&o.computeBoundingBox(),V.copy(o.boundingBox).applyMatrix4(a);let l;l=n?G*.5:Le(r,Math.max(r.near,V.distanceToPoint(W.origin)),s.resolution),V.expandByScalar(l),W.intersectsBox(V)!==!1&&(n?Re(this,t):ze(this,r,t))}onBeforeRender(e){let t=this.material.uniforms;t&&t.resolution&&(e.getViewport(Me),this.material.uniforms.resolution.value.set(Me.z,Me.w))}},Ve=class extends Be{constructor(e=new Ae,t=new je({color:Math.random()*16777215})){super(e,t),this.isLine2=!0,this.type=`Line2`}},K=e(s()),He=K.forwardRef(function({points:e,color:t=16777215,vertexColors:n,linewidth:r,lineWidth:i,segments:a,dashed:o,...s},c){var l;let u=j(e=>e.size),ee=K.useMemo(()=>a?new Be:new Ve,[a]),[d]=K.useState(()=>new je),f=(n==null||(l=n[0])==null?void 0:l.length)===4?4:3,p=K.useMemo(()=>{let r=a?new ke:new Ae,i=e.map(e=>{let t=Array.isArray(e);return e instanceof T||e instanceof D?[e.x,e.y,e.z]:e instanceof _?[e.x,e.y,0]:t&&e.length===3?[e[0],e[1],e[2]]:t&&e.length===2?[e[0],e[1],0]:e});if(r.setPositions(i.flat()),n){t=16777215;let e=n.map(e=>e instanceof w?e.toArray():e);r.setColors(e.flat(),f)}return r},[e,a,n,f]);return K.useLayoutEffect(()=>{ee.computeLineDistances()},[e,ee]),K.useLayoutEffect(()=>{o?d.defines.USE_DASH=``:delete d.defines.USE_DASH,d.needsUpdate=!0},[o,d]),K.useEffect(()=>()=>{p.dispose(),d.dispose()},[p]),K.createElement(`primitive`,O({object:ee,ref:c},s),K.createElement(`primitive`,{object:p,attach:`geometry`}),K.createElement(`primitive`,O({object:d,attach:`material`,color:t,vertexColors:!!n,resolution:[u.width,u.height],linewidth:r??i??1,dashed:o,transparent:f===4},s)))}),Ue=K.forwardRef(({threshold:e=15,geometry:t,...n},r)=>{let i=K.useRef(null);K.useImperativeHandle(r,()=>i.current,[]);let a=K.useMemo(()=>[0,0,0,1,0,0],[]),o=K.useRef(null),s=K.useRef(null);return K.useLayoutEffect(()=>{let n=i.current.parent,r=t??n?.geometry;if(!r||o.current===r&&s.current===e)return;o.current=r,s.current=e;let a=new f(r,e).attributes.position.array;i.current.geometry.setPositions(a),i.current.geometry.attributes.instanceStart.needsUpdate=!0,i.current.geometry.attributes.instanceEnd.needsUpdate=!0,i.current.computeLineDistances()}),K.createElement(He,O({segments:!0,points:a,ref:i,raycast:()=>null},n))});function We(e,t){let n=e+`Geometry`;return K.forwardRef(({args:e,children:r,...i},a)=>{let o=K.useRef(null);return K.useImperativeHandle(a,()=>o.current),K.useLayoutEffect(()=>void t?.(o.current)),K.createElement(`mesh`,O({ref:o},i),K.createElement(n,{attach:`geometry`,args:e}),r)})}var Ge=We(`box`),Ke=i(`circle-check`,[[`circle`,{cx:`12`,cy:`12`,r:`10`,key:`1mglay`}],[`path`,{d:`m9 12 2 2 4-4`,key:`dzmm74`}]]),qe=i(`circle-question-mark`,[[`circle`,{cx:`12`,cy:`12`,r:`10`,key:`1mglay`}],[`path`,{d:`M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3`,key:`1u773s`}],[`path`,{d:`M12 17h.01`,key:`p32p05`}]]),Je=i(`circle`,[[`circle`,{cx:`12`,cy:`12`,r:`10`,key:`1mglay`}]]),Ye=i(`clipboard`,[[`rect`,{width:`8`,height:`4`,x:`8`,y:`2`,rx:`1`,ry:`1`,key:`tgr4d6`}],[`path`,{d:`M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2`,key:`116196`}]]),Xe=i(`crosshair`,[[`circle`,{cx:`12`,cy:`12`,r:`10`,key:`1mglay`}],[`line`,{x1:`22`,x2:`18`,y1:`12`,y2:`12`,key:`l9bcsi`}],[`line`,{x1:`6`,x2:`2`,y1:`12`,y2:`12`,key:`13hhkx`}],[`line`,{x1:`12`,x2:`12`,y1:`6`,y2:`2`,key:`10w3f3`}],[`line`,{x1:`12`,x2:`12`,y1:`22`,y2:`18`,key:`15g9kq`}]]),Ze=i(`file-input`,[[`path`,{d:`M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4`,key:`1pf5j1`}],[`path`,{d:`M14 2v4a2 2 0 0 0 2 2h4`,key:`tnqrlb`}],[`path`,{d:`M2 15h10`,key:`jfw4w8`}],[`path`,{d:`m9 18 3-3-3-3`,key:`112psh`}]]),Qe=i(`focus`,[[`circle`,{cx:`12`,cy:`12`,r:`3`,key:`1v7zrd`}],[`path`,{d:`M3 7V5a2 2 0 0 1 2-2h2`,key:`aa7l1z`}],[`path`,{d:`M17 3h2a2 2 0 0 1 2 2v2`,key:`4qcy5o`}],[`path`,{d:`M21 17v2a2 2 0 0 1-2 2h-2`,key:`6vwrx8`}],[`path`,{d:`M7 21H5a2 2 0 0 1-2-2v-2`,key:`ioqczr`}]]),$e=i(`locate-fixed`,[[`line`,{x1:`2`,x2:`5`,y1:`12`,y2:`12`,key:`bvdh0s`}],[`line`,{x1:`19`,x2:`22`,y1:`12`,y2:`12`,key:`1tbv5k`}],[`line`,{x1:`12`,x2:`12`,y1:`2`,y2:`5`,key:`11lu5j`}],[`line`,{x1:`12`,x2:`12`,y1:`19`,y2:`22`,key:`x3vr5v`}],[`circle`,{cx:`12`,cy:`12`,r:`7`,key:`fim9np`}],[`circle`,{cx:`12`,cy:`12`,r:`3`,key:`1v7zrd`}]]),et=i(`orbit`,[[`path`,{d:`M20.341 6.484A10 10 0 0 1 10.266 21.85`,key:`1enhxb`}],[`path`,{d:`M3.659 17.516A10 10 0 0 1 13.74 2.152`,key:`1crzgf`}],[`circle`,{cx:`12`,cy:`12`,r:`3`,key:`1v7zrd`}],[`circle`,{cx:`19`,cy:`5`,r:`2`,key:`mhkx31`}],[`circle`,{cx:`5`,cy:`19`,r:`2`,key:`v8kfzx`}]]),tt=i(`pen-line`,[[`path`,{d:`M13 21h8`,key:`1jsn5i`}],[`path`,{d:`M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z`,key:`1a8usu`}]]),nt=i(`rotate-ccw`,[[`path`,{d:`M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8`,key:`1357e3`}],[`path`,{d:`M3 3v5h5`,key:`1xhq8a`}]]),rt=i(`search`,[[`path`,{d:`m21 21-4.34-4.34`,key:`14j7rj`}],[`circle`,{cx:`11`,cy:`11`,r:`8`,key:`4ej97u`}]]),it=i(`trash-2`,[[`path`,{d:`M10 11v6`,key:`nco0om`}],[`path`,{d:`M14 11v6`,key:`outv1u`}],[`path`,{d:`M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6`,key:`miytrc`}],[`path`,{d:`M3 6h18`,key:`d0wm0j`}],[`path`,{d:`M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2`,key:`e791ji`}]]),at=i(`triangle-alert`,[[`path`,{d:`m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3`,key:`wmoenq`}],[`path`,{d:`M12 9v4`,key:`juzpu7`}],[`path`,{d:`M12 17h.01`,key:`p32p05`}]]),ot=i(`undo-2`,[[`path`,{d:`M9 14 4 9l5-5`,key:`102s5s`}],[`path`,{d:`M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11`,key:`f3b9sd`}]]),st=[`change`,`fix`,`remove`,`liked`],ct=1e6,lt=4e3;function ut(e){return typeof e==`object`&&!!e&&!Array.isArray(e)}function dt(e){return ut(e)&&[e.x,e.y,e.z].every(e=>typeof e==`number`&&Number.isSafeInteger(e))}function ft(e,t){return e.x>=t.min.x&&e.x<=t.max.x&&e.y>=t.min.y&&e.y<=t.max.y&&e.z>=t.min.z&&e.z<=t.max.z}function pt(e){return e.min.x<=e.max.x&&e.min.y<=e.max.y&&e.min.z<=e.max.z}function mt(e){return JSON.stringify(Object.entries(e??{}).sort(([e],[t])=>e.localeCompare(t)))}function q(e){return ut(e)&&Object.keys(e).length<=64&&Object.entries(e).every(([e,t])=>e.length>0&&e.length<=100&&(typeof t==`boolean`||typeof t==`number`&&Number.isFinite(t)||typeof t==`string`&&t.length<=256))}function J(e){return typeof e==`string`&&e.length<=64&&Number.isFinite(Date.parse(e))}function Y(e){throw Error(`Invalid review: ${e}`)}function ht(e,t){return e.placements.reduce((e,n)=>e+ +!!ft(n,t),0)}function gt(e,t){let n=e.max.x-e.min.x+1,r=e.max.y-e.min.y+1,i=e.max.z-e.min.z+1,a=Math.max(0,n*r*i);return{width:n,height:r,depth:i,volume:a,blockCount:t,density:a?t/a:0}}function _t(e){let t=e.max.x-e.min.x,n=e.max.y-e.min.y,r=e.max.z-e.min.z;return{dx:t,dy:n,dz:r,horizontal:Math.hypot(t,r),direct:Math.hypot(t,n,r),manhattan:Math.abs(t)+Math.abs(n)+Math.abs(r)}}function vt(e){let t=e.trim(),n=t.match(/^(-?\d+)\s*(?:,|\s)\s*(-?\d+)\s*(?:,|\s)\s*(-?\d+)$/)??t.match(/^x\s*=\s*(-?\d+)\s*[,; ]+y\s*=\s*(-?\d+)\s*[,; ]+z\s*=\s*(-?\d+)$/i)??t.match(/^\/?tp\s+(?:@[pares](?:\[[^\]]*\])?\s+)?(-?\d+)\s+(-?\d+)\s+(-?\d+)$/i);if(!n)return;let[r,i,a]=n.slice(1).map(Number);return[r,i,a].every(Number.isSafeInteger)?{x:r,y:i,z:a}:void 0}function yt(e,t){let n=t.trim().toLowerCase().replace(/^minecraft:/,``);if(n.length<2)return{matches:[],capped:!1,tooShort:!!n};let r=[],i=!1;for(let t of e){let e=t.block.replace(`minecraft:`,``),a=Object.entries(t.state??{}).sort(([e],[t])=>e.localeCompare(t)).map(([e,t])=>`${e}=${String(t)}`).join(` `);if(`${e} ${e.replaceAll(`_`,` `)} ${t.phase} ${a}`.toLowerCase().includes(n)){if(r.length===500){i=!0;break}r.push(t)}}return{matches:r,capped:i,tooShort:!1}}function bt(e,t){let n=typeof e.reviewBuildId==`string`,r=typeof e.reviewBuildHash==`string`;return!n&&!r?`unbound`:!n||!r?`different`:e.reviewBuildId===t.id&&e.reviewBuildHash===t.hash?`current`:`different`}function xt(e,t){let n=`review_${(t??globalThis.crypto?.randomUUID?.()??`${Date.now().toString(36)}_${Math.random().toString(36).slice(2,12)}`).replace(/[^A-Za-z0-9._:]/g,`_`).slice(0,96)||`annotation`}`,r=new Set(e);if(!r.has(n))return n;let i=2;for(;r.has(`${n}_${i}`);)i+=1;return`${n}_${i}`}function St(e,t,n){if(e.length>=500)return;let r=xt(e.map(e=>e.id),n);return[{...t,id:r},...e]}function Ct(e,t){ut(e)||Y(`the JSON root must be an object.`),(e.type!==`blockwright-review`||e.schemaVersion!==1)&&Y(`unsupported type or schema version.`),(!ut(e.build)||e.build.hash!==t.hash)&&Y(`the immutable build hash does not match this build.`),(typeof e.build.id!=`string`||e.build.id!==t.id)&&Y(`the build id does not match this build.`),Array.isArray(e.annotations)||Y(`annotations must be an array.`),e.annotations.length>500&&Y(`at most 500 annotations may be imported at once.`),e.annotations.length*t.placements.length>12e6&&Y(`this annotation/build combination is too large to validate safely in the reviewer; split the review into smaller files.`);let n=new Set;return e.annotations.map((e,r)=>{let i=`annotation ${r+1}`;ut(e)||Y(`${i} must be an object.`),(typeof e.id!=`string`||!/^[A-Za-z0-9._:-]{1,128}$/.test(e.id))&&Y(`${i} has an invalid id.`),n.has(e.id)&&Y(`${i} repeats id ${e.id}.`),n.add(e.id),(typeof e.category!=`string`||!st.includes(e.category))&&Y(`${i} has an unsupported category.`),(typeof e.note!=`string`||e.note.length>4e3)&&Y(`${i} has an invalid or oversized note.`),J(e.createdAt)||Y(`${i} has an invalid createdAt timestamp.`),e.updatedAt!==void 0&&!J(e.updatedAt)&&Y(`${i} has an invalid updatedAt timestamp.`),e.resolved!==void 0&&typeof e.resolved!=`boolean`&&Y(`${i} has an invalid resolved flag.`),(!ut(e.bounds)||!dt(e.bounds.min)||!dt(e.bounds.max))&&Y(`${i} bounds must contain exact integer coordinates.`);let a={min:{...e.bounds.min},max:{...e.bounds.max}};pt(a)||Y(`${i} bounds are reversed.`),(!ft(a.min,t.bounds)||!ft(a.max,t.bounds))&&Y(`${i} is outside the immutable build bounds.`);let o=ht(t,a);if((typeof e.blockCount!=`number`||!Number.isSafeInteger(e.blockCount)||e.blockCount!==o)&&Y(`${i} block count does not match the canonical build.`),e.pickedBlock!==void 0&&(typeof e.pickedBlock!=`string`||e.pickedBlock.length>200)&&Y(`${i} has an invalid picked block.`),e.pickedState!==void 0&&!q(e.pickedState)&&Y(`${i} has an invalid picked state.`),e.pickedState!==void 0&&e.pickedBlock===void 0&&Y(`${i} has block state without a picked block.`),e.pickedBlock!==void 0){let n=e.pickedState===void 0?void 0:mt(e.pickedState);t.placements.some(t=>ft(t,a)&&t.block===e.pickedBlock&&(n===void 0||mt(t.state)===n))||Y(`${i} picked block or state is not canonical within its bounds.`)}return{id:e.id,category:e.category,note:e.note,bounds:a,blockCount:e.blockCount,...e.pickedBlock===void 0?{}:{pickedBlock:e.pickedBlock},...e.pickedState===void 0?{}:{pickedState:{...e.pickedState}},createdAt:e.createdAt,...e.resolved===void 0?{}:{resolved:e.resolved},...e.updatedAt===void 0?{}:{updatedAt:e.updatedAt}}})}function wt(e,t){let n=t?.input.rolePalette?.roof;return e.block===n||/roof|eave|ridge|gable|tile|finial|soffit/i.test(e.phase)||/roof_tile/.test(e.block)}var X=r(),Tt={change:`#e9ad4f`,fix:`#ef6b5b`,remove:`#c74f76`,liked:`#5ec6a7`},Z=({x:e,y:t,z:n})=>`${e},${t},${n}`,Et=e=>e.replace(`minecraft:`,``).split(`_`).map(e=>e[0].toUpperCase()+e.slice(1)).join(` `),Dt=e=>Object.entries(e??{}).sort(([e],[t])=>e.localeCompare(t)).map(([e,t])=>`${e}=${String(t)}`).join(`, `),Ot=(e,t)=>!!(e&&t&&e.x===t.x&&e.y===t.y&&e.z===t.z),kt=e=>({x:(e.min.x+e.max.x)/2,y:(e.min.y+e.max.y)/2,z:(e.min.z+e.max.z)/2}),Q=(e,t)=>String(e.state?.[t]??``),At=e=>({north:[0,-1],south:[0,1],west:[-1,0],east:[1,0]})[e]??[0,-1],jt=e=>({north:0,east:-Math.PI/2,south:Math.PI,west:Math.PI/2})[e]??0;function Mt(e){return/lantern|glowstone|froglight|shroomlight/.test(e)?`#e9ad4f`:/deepslate|blackstone|coal/.test(e)?`#30383d`:/stone|tuff|andesite|cobble/.test(e)?`#747a78`:/mangrove|crimson|brick|terracotta/.test(e)?`#7d3428`:/spruce|dark_oak/.test(e)?`#49311f`:/oak|bamboo|birch/.test(e)?`#ad8250`:/glass|pane|ice/.test(e)?`#8fc4cc`:/moss|grass|leaves|vine/.test(e)?`#52724c`:`#9ba0a2`}function Nt(e){let t=e.block,n=Q(e,`facing`)||`north`,r=Q(e,`half`)||`bottom`,[i,a]=At(n);if(t.endsWith(`_slab`)){let t=Q(e,`type`)||`bottom`;return t===`double`?[{size:[1,1,1],offset:[0,0,0]}]:[{size:[1,.5,1],offset:[0,t===`top`?.25:-.25,0]}]}if(t.endsWith(`_stairs`)){let e=r===`top`;return[{size:[1,.5,1],offset:[0,e?.25:-.25,0]},{size:[Math.abs(i)?.5:1,.5,Math.abs(a)?.5:1],offset:[i*.25,e?-.25:.25,a*.25]}]}if(t.endsWith(`_trapdoor`))return Q(e,`open`)===`true`?[{size:[Math.abs(i)?.1875:1,1,Math.abs(a)?.1875:1],offset:[i*.40625,0,a*.40625]}]:[{size:[1,.1875,1],offset:[0,r===`top`?.40625:-.40625,0]}];if(/glass_pane|iron_bars/.test(t)){let t=[{size:[.125,1,.125],offset:[0,0,0]}];return Q(e,`north`)===`true`&&t.push({size:[.125,1,.5],offset:[0,0,-.25]}),Q(e,`south`)===`true`&&t.push({size:[.125,1,.5],offset:[0,0,.25]}),Q(e,`west`)===`true`&&t.push({size:[.5,1,.125],offset:[-.25,0,0]}),Q(e,`east`)===`true`&&t.push({size:[.5,1,.125],offset:[.25,0,0]}),t}if(/_fence$|_wall$/.test(t)){let t=[{size:[.25,1,.25],offset:[0,0,0]}],n=t=>[`true`,`low`,`tall`].includes(Q(e,t));return n(`north`)&&t.push({size:[.25,.5,.5],offset:[0,.05,-.25]}),n(`south`)&&t.push({size:[.25,.5,.5],offset:[0,.05,.25]}),n(`west`)&&t.push({size:[.5,.5,.25],offset:[-.25,.05,0]}),n(`east`)&&t.push({size:[.5,.5,.25],offset:[.25,.05,0]}),t}return/_door$/.test(t)&&!/_trapdoor$/.test(t)?[{size:[1,1,.1875],offset:[0,0,0],rotationY:jt(n)}]:/(^|:)lantern$|soul_lantern$/.test(t)?[{size:[.5,.5,.5],offset:[0,-.05,0],role:`lantern`},{size:[.25,.18,.25],offset:[0,.29,0],role:`metal`},...Q(e,`hanging`)===`true`?[{size:[.12,.28,.12],offset:[0,.43,0],role:`metal`}]:[]]:[{size:[1,1,1],offset:[0,0,0]}]}function Pt({placements:e,part:t,block:n,textures:r,dimmed:i,onPick:a}){let o=(0,K.useRef)(null),s=(0,K.useMemo)(()=>{let e=r?.top,a=e?new d().load(e):void 0;a&&(a.colorSpace=y,a.magFilter=S,a.minFilter=h);let o=t.role===`lantern`?new w(`#b86b22`):new w(`#000000`);return new ne({color:e?`#ffffff`:t.role===`metal`?`#242a2c`:Mt(n),map:a,roughness:t.role===`metal`?.45:.88,metalness:t.role===`metal`?.5:0,transparent:i||/glass|pane|leaves/.test(n),opacity:i?.2:1,alphaTest:/glass|pane|leaves|door|trapdoor/.test(n)?.08:0,emissive:o,emissiveIntensity:t.role===`lantern`?1.1:0})},[n,i,t.role,r?.top]);return(0,K.useEffect)(()=>()=>{s.map?.dispose(),s.dispose()},[s]),(0,K.useEffect)(()=>{if(!o.current)return;let n=new fe,r=new v().setFromEuler(new k(0,t.rotationY??0,0));e.forEach((e,i)=>{n.compose(new T(e.x+t.offset[0],e.y+t.offset[1],e.z+t.offset[2]),r,new T(...t.size)),o.current.setMatrixAt(i,n)}),o.current.instanceMatrix.needsUpdate=!0},[e,t]),(0,X.jsx)(`instancedMesh`,{ref:o,args:[void 0,void 0,e.length],material:s,frustumCulled:!1,onClick:t=>{t.stopPropagation(),t.instanceId!==void 0&&a(e[t.instanceId])},children:(0,X.jsx)(`boxGeometry`,{args:[1,1,1]})})}function Ft({selection:e,color:t=`#f2b661`}){if(!e)return null;let n=[e.max.x-e.min.x+1.08,e.max.y-e.min.y+1.08,e.max.z-e.min.z+1.08],r=[(e.min.x+e.max.x)/2,(e.min.y+e.max.y)/2,(e.min.z+e.max.z)/2];return(0,X.jsxs)(Ge,{args:n,position:r,children:[(0,X.jsx)(`meshBasicMaterial`,{transparent:!0,opacity:.035,color:t,depthWrite:!1}),(0,X.jsx)(Ue,{color:t})]})}function It({build:e,maxLayer:t,hideRoof:n,cameraPreset:r,cameraTarget:i,cameraDistance:a,orthographic:o,selection:s,annotations:c,texturePack:l,onPick:u}){let ee=(0,K.useMemo)(()=>{let r=new Map;for(let i of e.placements){if(i.y>t||n&&wt(i,e))continue;let a=Te(i.block,i.state),o=r.get(a)??{placement:i,placements:[],parts:Nt(i)};o.placements.push(i),r.set(a,o)}return[...r.entries()]},[e,n,t]),d=[(e.bounds.min.x+e.bounds.max.x)/2,(e.bounds.min.y+e.bounds.max.y)/2,(e.bounds.min.z+e.bounds.max.z)/2],f=i?[i.x,i.y,i.z]:d,p=Math.max(e.bounds.dimensions.width,e.bounds.dimensions.depth,e.bounds.dimensions.height)*1.35,m=Math.max(6,Math.min(p,a??p)),h=`${r}-${Z({x:f[0],y:f[1],z:f[2]})}-${m.toFixed(2)}`,g={iso:[f[0]+m,f[1]+m*.65,f[2]-m],top:[f[0],f[1]+m*1.6,f[2]+.01],north:[f[0],f[1]+m*.3,f[2]-m*1.3],south:[f[0],f[1]+m*.3,f[2]+m*1.3],east:[f[0]+m*1.3,f[1]+m*.3,f[2]],west:[f[0]-m*1.3,f[1]+m*.3,f[2]]};return(0,X.jsxs)(Ce,{shadows:!0,dpr:[1,1.5],gl:{antialias:!0,alpha:!1},onPointerMissed:()=>void 0,children:[(0,X.jsx)(`color`,{attach:`background`,args:[`#06141e`]}),o?(0,X.jsx)(le,{makeDefault:!0,position:g[r],zoom:Math.max(4,850/m),onUpdate:e=>e.lookAt(...f)},`review-ortho-${h}`):(0,X.jsx)(ue,{makeDefault:!0,position:g[r],fov:42,onUpdate:e=>e.lookAt(...f)},`review-perspective-${h}`),(0,X.jsx)(`ambientLight`,{intensity:1.05,color:`#a8bfd0`}),(0,X.jsx)(`directionalLight`,{position:[f[0]+m,f[1]+m,f[2]-m],intensity:2.2,color:`#f5e7cf`,castShadow:!0}),ee.flatMap(([e,t])=>t.parts.map((n,r)=>(0,X.jsx)(Pt,{placements:t.placements,part:n,block:t.placement.block,textures:l?.textures.get(e),dimmed:!1,onPick:u},`${e}-${r}`))),(0,X.jsx)(Ft,{selection:s}),c.map(e=>(0,X.jsx)(Ft,{selection:e.bounds,color:e.resolved?`#536b76`:Tt[e.category]},e.id)),(0,X.jsx)(ve,{position:[d[0],e.bounds.min.y-.51,d[2]],args:[Math.max(64,p*2),Math.max(64,p*2)],cellSize:1,cellColor:`#294554`,sectionSize:5,sectionColor:`#3f6170`,fadeDistance:p*1.8,infiniteGrid:!0}),(0,X.jsx)(he,{makeDefault:!0,target:f,minDistance:2,maxDistance:p*4,maxPolarAngle:Math.PI/2.01,enabled:!0})]})}function Lt(e,t){return{min:{x:Math.min(e.x,t.x),y:Math.min(e.y,t.y),z:Math.min(e.z,t.z)},max:{x:Math.max(e.x,t.x),y:Math.max(e.y,t.y),z:Math.max(e.z,t.z)}}}function $({label:e,shortcut:t,active:n,disabled:r,onClick:i,children:a}){let o=t?`${e} (${t})`:e;return(0,X.jsx)(`button`,{type:`button`,className:`review-icon-button ${n?`active`:``}`,"aria-label":o,"aria-pressed":n===void 0?void 0:n,title:o,disabled:r,onClick:i,children:a})}function Rt(e){return{reviewBuildId:e?.id,reviewBuildHash:e?.hash,mode:`orbit`,layer:e?.bounds.max.y??0,hideRoof:!1,orthographic:!1,cameraPreset:`iso`,cameraTarget:void 0,cameraDistance:void 0,annotations:[],selection:void 0,anchor:void 0,searchQuery:``,searchCursor:-1,auditQuery:``,auditSeverity:`all`,annotationQuery:``,annotationCategory:`all`,annotationStatus:`all`,focusedFindingCode:void 0,focusedFindingIndex:void 0}}function zt(){let{output:e,isPending:t,responseMetadata:r}=o(),[i,s]=a(),{maxHeight:ee}=n(),{download:d}=te(),f=r?.build,p=r?.audit,m=e?.review,h=f?.bounds.max.y??0,g=f?.bounds.min.y??0,[_,v]=l(Rt(f)),y=(f?bt(_,f):`unbound`)===`current`?_:Rt(f),b=y.mode??`orbit`,ne=y.layer??h,x=y.hideRoof??!1,S=y.orthographic??!1,C=y.cameraPreset??`iso`,w=y.cameraTarget,re=y.cameraDistance,T=Array.isArray(y.annotations)?y.annotations:[],E=y.selection,D=y.anchor,O=y.searchQuery??``,ae=y.auditQuery??``,le=y.auditSeverity??`all`,ue=y.annotationQuery??``,fe=y.annotationCategory??`all`,pe=y.annotationStatus??`all`,[he,ve]=(0,K.useState)(`fix`),[Ce,k]=(0,K.useState)(``),[A,j]=(0,K.useState)(),[M,Te]=(0,K.useState)(),[N,P]=(0,K.useState)(),[Oe,F]=(0,K.useState)(!1),[ke,Ae]=(0,K.useState)(null),[je,Me]=(0,K.useState)(`Procedural fallback`),Ne=(0,K.useRef)(null),Pe=(0,K.useRef)(null),I=(0,K.useRef)(null),L=f?`${f.id}:${f.hash}`:``,R=(0,K.useRef)(L);R.current=L;let Fe=(0,K.useMemo)(()=>{let e=new Map;for(let t of f?.placements??[])e.set(Z(t),t);return e},[f]),Ie=(0,K.useMemo)(()=>f?.placements.reduce((e,t)=>e+ +(t.y<=ne&&(!x||!wt(t,f))),0)??0,[f,x,ne]),z=(0,K.useMemo)(()=>!f||vt(O)?{matches:[],capped:!1,tooShort:!1}:yt(f.placements,O),[f,O]),B=z.matches,V=(0,K.useMemo)(()=>{if(!p)return[];let e=ae.trim().toLowerCase();return p.findings.filter(t=>(le===`all`||t.severity===le)&&(!e||`${t.code.replaceAll(`_`,` `)} ${t.message} ${t.coordinates.map(Z).join(` `)}`.toLowerCase().includes(e)))},[p,ae,le]),H=(0,K.useMemo)(()=>V.flatMap(e=>e.coordinates.map((t,n)=>({finding:e,coordinate:t,coordinateIndex:n}))),[V]),U=(0,K.useMemo)(()=>{let e=ue.trim().toLowerCase();return T.filter(t=>(fe===`all`||t.category===fe)&&(pe===`all`||pe===`resolved`==!!t.resolved)&&(!e||`${t.category} ${t.note} ${t.pickedBlock??``} ${Z(t.bounds.min)} ${Z(t.bounds.max)}`.toLowerCase().includes(e)))},[fe,ue,pe,T]);if((0,K.useEffect)(()=>{if(!f)return;let e=bt(_,f);if(e===`different`){v(Rt(f)),ve(`fix`),k(``),j(void 0),Te(void 0),F(!1),Ae(null),Me(`Procedural fallback`),P({kind:`info`,message:`Build changed; previous build-bound review state was cleared.`});return}if(e===`unbound`){let e=[],t=Array.isArray(_.annotations)?_.annotations:[];try{e=Ct({schemaVersion:1,type:`blockwright-review`,build:{id:f.id,hash:f.hash},annotations:t},f)}catch{}v({...Rt(f),annotations:e}),t.length&&!e.length&&P({kind:`info`,message:`Older saved annotations could not be verified for this build and were cleared.`});return}let t=Array.isArray(_.annotations)?_.annotations:[],n=t.length>500?t.slice(0,500):t,r=typeof _.layer==`number`&&_.layer>=f.bounds.min.y&&_.layer<=f.bounds.max.y?_.layer:f.bounds.max.y;(n!==_.annotations||r!==_.layer)&&(v(e=>({...e,layer:r,annotations:n})),t.length>500&&P({kind:`info`,message:`Saved review state was repaired to the 500-annotation limit.`}))},[f?.hash,f?.id,_.annotations?.length,_.reviewBuildHash,_.reviewBuildId]),(0,K.useEffect)(()=>()=>ke?.dispose(),[ke]),(0,K.useEffect)(()=>{if(i!==`fullscreen`)return;let e=e=>{let t=e.target?.matches(`input, textarea, select, [contenteditable='true']`);if(e.key===`Escape`){Oe?F(!1):(j(void 0),k(``),v(e=>({...e,anchor:void 0,selection:void 0})));return}if(t)return;let n=e.key.toLowerCase(),r={o:`orbit`,b:`select`,r:`region`,m:`measure`},i={1:`iso`,2:`top`,3:`north`,4:`south`,5:`east`,6:`west`};r[n]?(e.preventDefault(),v(e=>({...e,mode:r[n],anchor:void 0}))):i[n]?(e.preventDefault(),v(e=>({...e,cameraPreset:i[n]}))):n===`0`?(e.preventDefault(),v(e=>({...e,cameraTarget:void 0,cameraDistance:void 0}))):n===`p`?(e.preventDefault(),v(e=>({...e,orthographic:!e.orthographic}))):n===`h`?(e.preventDefault(),v(e=>({...e,hideRoof:!e.hideRoof}))):e.key===`[`?(e.preventDefault(),v(e=>({...e,layer:Math.max(g,(e.layer??h)-1)}))):e.key===`]`?(e.preventDefault(),v(e=>({...e,layer:Math.min(h,(e.layer??h)+1)}))):e.key===`?`||e.key===`/`&&e.shiftKey?(e.preventDefault(),F(e=>!e)):e.key===`/`&&(e.preventDefault(),I.current?.focus())};return window.addEventListener(`keydown`,e),()=>window.removeEventListener(`keydown`,e)},[i,h,g,Oe]),t||!f||!m||!p)return(0,X.jsxs)(`div`,{className:`loading-view`,children:[(0,X.jsx)(ce,{size:34}),(0,X.jsx)(`span`,{children:`Preparing exact 3D review…`})]});let W=e=>{let t={x:e.x,y:e.y,z:e.z};return{...Lt(t,t),type:`block`,blockCount:1,pickedBlock:e.block,pickedState:e.state,pickedPhase:e.phase}},G=e=>{let t=gt(e,0);v(n=>({...n,cameraTarget:kt(e),cameraDistance:Math.max(6,Math.max(t.width,t.height,t.depth)*2.1),layer:Math.max(g,Math.min(h,e.max.y))}))},Le=(e,t)=>{let n={x:e.x,y:e.y,z:e.z};v(r=>({...r,mode:`select`,selection:W(e),anchor:void 0,layer:n.y,hideRoof:!wt(e,f)&&r.hideRoof,cameraTarget:n,cameraDistance:8,focusedFindingCode:t?.code,focusedFindingIndex:t?.coordinateIndex}))},Re=e=>{let t=Fe.get(Z(e.coordinate));if(!t){P({kind:`error`,message:`Audit coordinate ${Z(e.coordinate)} is not present in the immutable build.`});return}Le(t,{code:e.finding.code,coordinateIndex:e.coordinateIndex}),P({kind:`info`,message:`${e.finding.code.replaceAll(`_`,` `)} · sample ${e.coordinateIndex+1} of ${e.finding.coordinates.length}`})},ze=e=>{if(!H.length)return;let t=H.findIndex(e=>e.finding.code===y.focusedFindingCode&&e.coordinateIndex===y.focusedFindingIndex),n=t<0?e>0?0:H.length-1:(t+e+H.length)%H.length;Re(H[n])},Be=e=>{let t={x:e.x,y:e.y,z:e.z};if(b===`orbit`)return;if(b===`select`){v(t=>({...t,selection:W(e),anchor:void 0}));return}if(!D){v(e=>({...e,anchor:t,selection:void 0}));return}let n=Lt(D,t);v(t=>({...t,anchor:void 0,selection:{...n,type:b===`measure`?`measure`:`region`,blockCount:ht(f,n),pickedBlock:e.block,pickedState:e.state,pickedPhase:e.phase}}))},Ve=()=>{let e=Ce.trim();if(!E||E.type===`measure`||!e)return;if(!A&&T.length>=500){P({kind:`error`,message:`This review already has the maximum 500 annotations. Resolve, edit, or remove an existing note before adding another.`});return}let t=new Date().toISOString();if(A){if(!T.some(e=>e.id===A)){j(void 0),P({kind:`error`,message:`That annotation is no longer present; no changes were saved.`});return}v(n=>({...n,annotations:n.annotations.map(n=>n.id===A?{...n,category:he,note:e,bounds:{min:E.min,max:E.max},blockCount:E.blockCount,pickedBlock:E.pickedBlock,pickedState:E.pickedState,updatedAt:t}:n),selection:void 0})),P({kind:`success`,message:`Annotation updated.`}),j(void 0),k(``);return}let n=globalThis.crypto?.randomUUID?.()??`${Date.now().toString(36)}_${Math.random().toString(36).slice(2,12)}`,r={category:he,note:e,bounds:{min:E.min,max:E.max},blockCount:E.blockCount,pickedBlock:E.pickedBlock,pickedState:E.pickedState,createdAt:t};v(e=>{let t=St(Array.isArray(e.annotations)?e.annotations:[],r,n);return t?{...e,annotations:t,selection:void 0}:e}),k(``),P({kind:`success`,message:`Annotation saved to exact coordinates.`})},He=e=>{ve(e.category),k(e.note),j(e.id);let t=f.placements.find(t=>t.x>=e.bounds.min.x&&t.x<=e.bounds.max.x&&t.y>=e.bounds.min.y&&t.y<=e.bounds.max.y&&t.z>=e.bounds.min.z&&t.z<=e.bounds.max.z&&(!e.pickedBlock||t.block===e.pickedBlock));v(n=>({...n,selection:{...e.bounds,type:e.bounds.min.x===e.bounds.max.x&&e.bounds.min.y===e.bounds.max.y&&e.bounds.min.z===e.bounds.max.z?`block`:`region`,blockCount:e.blockCount,pickedBlock:e.pickedBlock,pickedState:e.pickedState,pickedPhase:t?.phase},anchor:void 0})),G(e.bounds),P({kind:`info`,message:`Editing annotation; save to apply changes.`})},Ue=e=>{let t=T.findIndex(t=>t.id===e.id);Te({annotation:e,index:Math.max(0,t)}),v(t=>({...t,annotations:t.annotations.filter(t=>t.id!==e.id)})),A===e.id&&(j(void 0),k(``)),P({kind:`info`,message:`Annotation removed. Undo is available.`})},We=()=>{M&&(v(e=>{if(e.annotations.some(e=>e.id===M.annotation.id)||e.annotations.length>=500)return e;let t=[...e.annotations];return t.splice(Math.min(M.index,t.length),0,M.annotation),{...e,annotations:t}}),Te(void 0),P({kind:`success`,message:`Annotation restored.`}))},Ge=e=>{let t=!e.resolved;v(n=>({...n,annotations:n.annotations.map(n=>n.id===e.id?{...n,resolved:t,updatedAt:new Date().toISOString()}:n)})),P({kind:`success`,message:t?`Annotation marked resolved.`:`Annotation reopened.`})},ut=async()=>{let e=L,t=f.input.name.toLowerCase().replace(/[^a-z0-9]+/g,`-`).replace(/^-|-$/g,``)||`blockwright-build`,n={schemaVersion:1,type:`blockwright-review`,build:{id:f.id,hash:f.hash,name:f.input.name,edition:f.input.edition,version:f.input.version,bounds:f.bounds},annotations:T,audit:p,viewer:{mode:b,layer:ne,hideRoof:x,orthographic:S,cameraPreset:C,cameraTarget:w,cameraDistance:re},exportedAt:new Date().toISOString()};try{Ct(n,f);let r=JSON.stringify(n,null,2);if(new TextEncoder().encode(r).byteLength>1e6)throw Error(`This review exceeds the ${Math.round(ct/1e3)} KB import limit. Shorten or remove annotations before exporting.`);if(R.current!==e)throw Error(`The build changed before export completed. Export the newly opened review instead.`);let i=await d({contents:[{type:`resource`,resource:{uri:`file:///${t}-review.json`,mimeType:`application/json`,text:r}}]});if(R.current!==e)return;P(i.isError?{kind:`info`,message:`Review export was canceled or unavailable.`}:{kind:`success`,message:`Exported ${T.length} annotations for build ${f.hash.slice(0,12)}.`})}catch(e){P({kind:`error`,message:e instanceof Error?e.message:`Could not export this review.`})}},dt=async e=>{if(!e)return;let t=L;try{if(e.size>1e6)throw Error(`Review files must be ${Math.round(ct/1e3)} KB or smaller.`);if(!e.name.toLowerCase().endsWith(`.json`))throw Error(`Choose a Blockwright review JSON file.`);let n=await e.text();if(R.current!==t)throw Error(`The build changed while the review file was being read. Choose the file again for the current build.`);let r=Ct(JSON.parse(n),f);v(e=>bt(e,f)===`current`?{...e,annotations:r}:e),j(void 0),Te(void 0),k(``),P({kind:`success`,message:`Imported ${r.length} validated annotation${r.length===1?``:`s`}; build hash matched.`})}catch(e){P({kind:`error`,message:e instanceof Error?e.message:`Could not import this review.`})}},ft=async e=>{if(!e)return;let t=L;Me(`Reading ${e.name}…`);try{let n=await De(e,f.placements);if(R.current!==t){n.dispose();return}Ae(e=>(e?.dispose(),n)),Me(`${n.name} · ${n.resolved}/${n.requested} states resolved`),P({kind:`success`,message:`${n.resolved} of ${n.requested} material states resolved from ${n.name}.`})}catch(e){Me(e instanceof Error?e.message:`Could not read this resource pack.`),P({kind:`error`,message:e instanceof Error?e.message:`Could not read this resource pack.`})}},pt=()=>{let e=vt(O);if(e){let t=Fe.get(Z(e));if(!t){P({kind:`error`,message:`No canonical block exists at ${Z(e)}.`});return}Le(t),P({kind:`success`,message:`Focused ${t.block} at ${Z(t)}.`});return}if(!B.length){let e=O.trim();P({kind:`error`,message:z.tooShort?`Use at least 2 characters for block, phase, or state search; exact coordinates are always accepted.`:e?`No block, phase, or state matches “${e}”.`:`Enter coordinates, a block, phase, or state.`});return}let t=((y.searchCursor??-1)+1)%B.length,n=B[t];Le(n),v(e=>({...e,searchCursor:t})),P({kind:`success`,message:`Match ${t+1} of ${B.length}${z.capped?`+ capped results`:``}: ${n.block} at ${Z(n)}.`})},mt=async(e,t)=>{try{if(!navigator.clipboard?.writeText)throw Error(`Clipboard access is unavailable in this host.`);await navigator.clipboard.writeText(e),P({kind:`success`,message:`${t} copied.`})}catch(e){P({kind:`error`,message:e instanceof Error?e.message:`Could not copy to the clipboard.`})}},q=E?gt(E,E.blockCount):void 0,J=E?.type===`measure`?_t(E):void 0,Y=E?.pickedState?Dt(E.pickedState):``,xt=Math.max(g,Math.min(ne,h)),Q=T.filter(e=>!e.resolved).length,At=p.findings.find(e=>e.code===y.focusedFindingCode),jt=`Reviewing ${f.input.name}, immutable hash ${f.hash.slice(0,12)}. ${Ie} of ${f.placements.length} blocks visible through Y ${xt}; ${x?`roof hidden`:`roof visible`}. Camera ${C} ${S?`orthographic`:`perspective`}${w?` focused at ${Z(w)}`:` framed on the full build`}. ${T.length} annotations: ${Q} open and ${T.length-Q} resolved. ${E?`Selected ${E.type} from ${Z(E.min)} to ${Z(E.max)}${E.pickedBlock?`; canonical block ${E.pickedBlock}${Y?` with state ${Y}`:``}`:``}.`:`No selection.`} ${At?`Current audit finding ${At.code}, sample ${(y.focusedFindingIndex??0)+1}.`:``} Global audit: ${p.totals.errors} errors and ${p.totals.warnings} warnings across ${p.scannedPlacements} placements.`;return i===`fullscreen`?(0,X.jsx)(u,{content:jt,children:(0,X.jsxs)(`main`,{className:`review-shell`,style:{maxHeight:ee||void 0},children:[(0,X.jsxs)(`header`,{className:`review-header`,children:[(0,X.jsxs)(`div`,{children:[(0,X.jsx)(`span`,{className:`panel-kicker`,children:`Blockwright reviewer`}),(0,X.jsx)(`h1`,{children:f.input.name})]}),(0,X.jsxs)(`div`,{className:`review-header-actions`,children:[(0,X.jsxs)(`button`,{onClick:()=>Pe.current?.click(),children:[(0,X.jsx)(Ee,{size:15}),`Textures`]}),(0,X.jsxs)(`button`,{onClick:()=>Ne.current?.click(),children:[(0,X.jsx)(Ze,{size:15}),`Import review`]}),(0,X.jsxs)(`button`,{className:`primary-button`,onClick:()=>void ut(),children:[(0,X.jsx)(be,{size:15}),`Export review`]}),(0,X.jsx)($,{label:`Collapse reviewer`,onClick:()=>s(`inline`),children:(0,X.jsx)(c,{size:16})})]}),(0,X.jsx)(`input`,{ref:Pe,hidden:!0,type:`file`,accept:`.zip,.jar,application/zip,application/java-archive`,onChange:e=>void ft(e.target.files?.[0])}),(0,X.jsx)(`input`,{ref:Ne,hidden:!0,type:`file`,accept:`.json,application/json`,onChange:e=>{let t=e.currentTarget.files?.[0];e.currentTarget.value=``,dt(t)}})]}),(0,X.jsxs)(`aside`,{className:`review-tools`,"aria-label":`Review tools`,children:[(0,X.jsx)($,{label:`Orbit`,shortcut:`O`,active:b===`orbit`,onClick:()=>v(e=>({...e,mode:`orbit`,anchor:void 0})),children:(0,X.jsx)(et,{size:19})}),(0,X.jsx)($,{label:`Select block`,shortcut:`B`,active:b===`select`,onClick:()=>v(e=>({...e,mode:`select`,anchor:void 0})),children:(0,X.jsx)(de,{size:19})}),(0,X.jsx)($,{label:`Select region`,shortcut:`R`,active:b===`region`,onClick:()=>v(e=>({...e,mode:`region`,anchor:void 0})),children:(0,X.jsx)(ge,{size:19})}),(0,X.jsx)($,{label:`Measure`,shortcut:`M`,active:b===`measure`,onClick:()=>v(e=>({...e,mode:`measure`,anchor:void 0})),children:(0,X.jsx)(ye,{size:19})}),(0,X.jsx)($,{label:`Frame whole build`,shortcut:`0`,active:!w,onClick:()=>v(e=>({...e,cameraTarget:void 0,cameraDistance:void 0})),children:(0,X.jsx)(Qe,{size:19})}),(0,X.jsx)(`span`,{className:`review-tools-spacer`}),(0,X.jsx)($,{label:`Isometric view`,shortcut:`1`,active:C===`iso`,onClick:()=>v(e=>({...e,cameraPreset:`iso`})),children:(0,X.jsx)(Xe,{size:19})}),(0,X.jsx)($,{label:`Top view`,shortcut:`2`,active:C===`top`,onClick:()=>v(e=>({...e,cameraPreset:`top`})),children:(0,X.jsx)(oe,{size:19})}),(0,X.jsx)($,{label:`North view`,shortcut:`3`,active:C===`north`,onClick:()=>v(e=>({...e,cameraPreset:`north`})),children:(0,X.jsx)(se,{size:19})}),(0,X.jsx)($,{label:`South view`,shortcut:`4`,active:C===`south`,onClick:()=>v(e=>({...e,cameraPreset:`south`})),children:(0,X.jsx)(oe,{size:19})}),(0,X.jsx)($,{label:`East view`,shortcut:`5`,active:C===`east`,onClick:()=>v(e=>({...e,cameraPreset:`east`})),children:(0,X.jsx)(me,{size:19})}),(0,X.jsx)($,{label:`West view`,shortcut:`6`,active:C===`west`,onClick:()=>v(e=>({...e,cameraPreset:`west`})),children:(0,X.jsx)(Se,{size:19})}),(0,X.jsx)($,{label:`Keyboard shortcuts`,shortcut:`?`,active:Oe,onClick:()=>F(e=>!e),children:(0,X.jsx)(qe,{size:19})})]}),(0,X.jsxs)(`section`,{className:`review-viewport`,children:[(0,X.jsx)(It,{build:f,maxLayer:xt,hideRoof:x,cameraPreset:C,cameraTarget:w,cameraDistance:re,orthographic:S,selection:E,annotations:T,texturePack:ke,onPick:Be}),(0,X.jsxs)(`form`,{className:`review-search`,role:`search`,onSubmit:e=>{e.preventDefault(),pt()},children:[(0,X.jsx)(rt,{size:14,"aria-hidden":`true`}),(0,X.jsx)(`input`,{ref:I,"aria-label":`Find exact coordinates, block, phase, or state`,value:O,onChange:e=>v(t=>({...t,searchQuery:e.target.value,searchCursor:-1})),placeholder:`x,y,z or block / phase / state`}),O&&(0,X.jsx)(`button`,{type:`button`,"aria-label":`Clear search`,onClick:()=>v(e=>({...e,searchQuery:``,searchCursor:-1})),children:(0,X.jsx)(xe,{size:13})}),(0,X.jsxs)(`button`,{type:`submit`,children:[`Find`,B.length?` · ${B.length}${z.capped?`+`:``}`:``]})]}),(0,X.jsxs)(`div`,{className:`review-view-switch`,"aria-label":`Camera projection`,children:[(0,X.jsx)(`button`,{type:`button`,"aria-pressed":!S,className:S?``:`active`,onClick:()=>v(e=>({...e,orthographic:!1})),children:`Perspective`}),(0,X.jsx)(`button`,{type:`button`,"aria-pressed":S,className:S?`active`:``,onClick:()=>v(e=>({...e,orthographic:!0})),children:`Orthographic`})]}),(0,X.jsxs)(`div`,{className:`review-viewport-status`,children:[(0,X.jsxs)(`span`,{children:[Ie.toLocaleString(),` / `,f.placements.length.toLocaleString(),` visible`]}),w&&(0,X.jsxs)(`span`,{children:[`Focus `,Z(w)]})]}),(0,X.jsxs)(`div`,{className:`review-layer-control`,children:[(0,X.jsx)(ie,{size:15}),(0,X.jsx)(`input`,{"aria-label":`Maximum visible Y layer ${xt}`,type:`range`,min:g,max:h,value:xt,onChange:e=>v(t=>({...t,layer:Number(e.target.value)}))}),(0,X.jsxs)(`strong`,{children:[`Y ≤ `,xt]}),(0,X.jsxs)(`label`,{children:[(0,X.jsx)(`input`,{type:`checkbox`,checked:x,onChange:e=>v(t=>({...t,hideRoof:e.target.checked}))}),`Hide roof `,(0,X.jsx)(`kbd`,{children:`H`})]})]}),D&&(0,X.jsxs)(`div`,{className:`review-instruction`,role:`status`,children:[`First corner: `,Z(D),` · choose the second point `,(0,X.jsx)(`button`,{type:`button`,onClick:()=>v(e=>({...e,anchor:void 0})),children:`Cancel`})]}),N&&(0,X.jsxs)(`div`,{className:`review-activity ${N.kind}`,role:N.kind===`error`?`alert`:`status`,"aria-live":`polite`,children:[N.kind===`error`?(0,X.jsx)(at,{size:14}):N.kind===`success`?(0,X.jsx)(Ke,{size:14}):(0,X.jsx)(_e,{size:14}),(0,X.jsx)(`span`,{children:N.message}),(0,X.jsx)(`button`,{type:`button`,"aria-label":`Dismiss message`,onClick:()=>P(void 0),children:(0,X.jsx)(xe,{size:13})})]}),Oe&&(0,X.jsxs)(`section`,{className:`review-shortcuts`,"aria-label":`Keyboard shortcuts`,children:[(0,X.jsxs)(`header`,{children:[(0,X.jsx)(`strong`,{children:`Keyboard shortcuts`}),(0,X.jsx)(`button`,{type:`button`,"aria-label":`Close keyboard shortcuts`,onClick:()=>F(!1),children:(0,X.jsx)(xe,{size:14})})]}),(0,X.jsxs)(`dl`,{children:[(0,X.jsxs)(`div`,{children:[(0,X.jsxs)(`dt`,{children:[(0,X.jsx)(`kbd`,{children:`O`}),` `,(0,X.jsx)(`kbd`,{children:`B`}),` `,(0,X.jsx)(`kbd`,{children:`R`}),` `,(0,X.jsx)(`kbd`,{children:`M`})]}),(0,X.jsx)(`dd`,{children:`Orbit, block, region, measure`})]}),(0,X.jsxs)(`div`,{children:[(0,X.jsxs)(`dt`,{children:[(0,X.jsx)(`kbd`,{children:`1`}),`–`,(0,X.jsx)(`kbd`,{children:`6`})]}),(0,X.jsx)(`dd`,{children:`Isometric, top, cardinal views`})]}),(0,X.jsxs)(`div`,{children:[(0,X.jsx)(`dt`,{children:(0,X.jsx)(`kbd`,{children:`0`})}),(0,X.jsx)(`dd`,{children:`Frame the whole build`})]}),(0,X.jsxs)(`div`,{children:[(0,X.jsxs)(`dt`,{children:[(0,X.jsx)(`kbd`,{children:`P`}),` `,(0,X.jsx)(`kbd`,{children:`H`})]}),(0,X.jsx)(`dd`,{children:`Projection and roof visibility`})]}),(0,X.jsxs)(`div`,{children:[(0,X.jsxs)(`dt`,{children:[(0,X.jsx)(`kbd`,{children:`[`}),` `,(0,X.jsx)(`kbd`,{children:`]`})]}),(0,X.jsx)(`dd`,{children:`Move the visible Y layer`})]}),(0,X.jsxs)(`div`,{children:[(0,X.jsxs)(`dt`,{children:[(0,X.jsx)(`kbd`,{children:`/`}),` `,(0,X.jsx)(`kbd`,{children:`?`})]}),(0,X.jsx)(`dd`,{children:`Search and shortcut help`})]}),(0,X.jsxs)(`div`,{children:[(0,X.jsx)(`dt`,{children:(0,X.jsx)(`kbd`,{children:`Esc`})}),(0,X.jsx)(`dd`,{children:`Cancel anchor or clear selection`})]}),(0,X.jsxs)(`div`,{children:[(0,X.jsxs)(`dt`,{children:[(0,X.jsx)(`kbd`,{children:`Ctrl`}),`+`,(0,X.jsx)(`kbd`,{children:`Enter`})]}),(0,X.jsx)(`dd`,{children:`Save the annotation draft`})]})]})]})]}),(0,X.jsxs)(`aside`,{className:`review-inspector`,"aria-label":`Build review inspector`,children:[(0,X.jsxs)(`section`,{children:[(0,X.jsxs)(`div`,{className:`review-section-heading`,children:[(0,X.jsx)(`span`,{className:`panel-kicker`,children:A?`Edit annotation`:`New annotation`}),A?(0,X.jsx)(`button`,{type:`button`,className:`review-text-button`,onClick:()=>{j(void 0),k(``)},children:`Cancel edit`}):(0,X.jsx)(`small`,{children:`exact world coordinates`})]}),(0,X.jsx)(`div`,{className:`review-category-row`,children:st.map(e=>(0,X.jsx)(`button`,{type:`button`,"aria-pressed":he===e,className:he===e?`active`:``,style:{"--category":Tt[e]},onClick:()=>ve(e),children:e},e))}),(0,X.jsxs)(`label`,{className:`review-field-label`,htmlFor:`review-annotation-note`,children:[`Actionable intent `,(0,X.jsxs)(`span`,{children:[Ce.length,`/`,lt]})]}),(0,X.jsx)(`textarea`,{id:`review-annotation-note`,maxLength:lt,value:Ce,onChange:e=>k(e.target.value),onKeyDown:e=>{e.key===`Enter`&&(e.ctrlKey||e.metaKey)&&(e.preventDefault(),Ve())},placeholder:`Describe the issue, intended rule, or detail to preserve…`}),(0,X.jsxs)(`button`,{type:`button`,className:`primary-button review-save`,disabled:!E||E.type===`measure`||!Ce.trim()||!A&&T.length>=500,onClick:Ve,children:[(0,X.jsx)(we,{size:15}),A?`Update annotation`:`Save annotation`]}),!A&&T.length>=500&&(0,X.jsxs)(`small`,{className:`review-help-text`,children:[`Annotation limit reached (`,500,`/`,500,`). Existing notes can still be edited or resolved.`]}),!E&&(0,X.jsx)(`small`,{className:`review-help-text`,children:`Select a block or region first. Measurements stay separate from annotations.`})]}),(0,X.jsxs)(`section`,{children:[(0,X.jsxs)(`div`,{className:`review-section-heading`,children:[(0,X.jsx)(`span`,{className:`panel-kicker`,children:`Selection`}),(0,X.jsx)(`small`,{children:E?.type??`none`})]}),E?(0,X.jsxs)(`div`,{className:`review-selection-card`,children:[(0,X.jsxs)(`div`,{className:`review-selection-title`,children:[(0,X.jsxs)(`strong`,{children:[E.blockCount.toLocaleString(),` occupied block`,E.blockCount===1?``:`s`]}),(0,X.jsx)(`button`,{type:`button`,title:`Frame selection`,"aria-label":`Frame selection`,onClick:()=>G(E),children:(0,X.jsx)($e,{size:14})})]}),(0,X.jsxs)(`span`,{children:[`Min `,(0,X.jsx)(`code`,{children:Z(E.min)})]}),(0,X.jsxs)(`span`,{children:[`Max `,(0,X.jsx)(`code`,{children:Z(E.max)})]}),q&&(0,X.jsxs)(`span`,{children:[`Inclusive size `,(0,X.jsxs)(`b`,{children:[q.width,` × `,q.height,` × `,q.depth]}),` · volume `,q.volume.toLocaleString()]}),q&&E.type!==`block`&&(0,X.jsxs)(`span`,{children:[`Occupancy `,(q.density*100).toFixed(1),`%`]}),E.pickedBlock&&(0,X.jsxs)(`span`,{className:`review-canonical`,children:[(0,X.jsx)(`b`,{children:Et(E.pickedBlock)}),(0,X.jsx)(`code`,{children:E.pickedBlock})]}),E.pickedPhase&&(0,X.jsxs)(`span`,{children:[`Phase `,(0,X.jsx)(`b`,{children:E.pickedPhase})]}),Y&&(0,X.jsx)(`code`,{children:Y}),J&&(0,X.jsxs)(`div`,{className:`review-measurements`,children:[(0,X.jsxs)(`span`,{children:[`Axis Δ `,(0,X.jsxs)(`b`,{children:[J.dx,`, `,J.dy,`, `,J.dz]})]}),(0,X.jsxs)(`span`,{children:[`Horizontal `,(0,X.jsx)(`b`,{children:J.horizontal.toFixed(2)})]}),(0,X.jsxs)(`span`,{children:[`Direct center-to-center `,(0,X.jsx)(`b`,{children:J.direct.toFixed(2)})]}),(0,X.jsxs)(`span`,{children:[`Manhattan `,(0,X.jsx)(`b`,{children:J.manhattan})]})]}),(0,X.jsxs)(`div`,{className:`review-copy-row`,children:[(0,X.jsxs)(`button`,{type:`button`,onClick:()=>void mt(Z(E.min),`Minimum coordinates`),children:[(0,X.jsx)(Ye,{size:12}),`Copy min`]}),(0,X.jsxs)(`button`,{type:`button`,onClick:()=>void mt(`/tp @s ${E.min.x} ${E.min.y} ${E.min.z}`,`Teleport command`),children:[(0,X.jsx)(Ye,{size:12}),`Copy /tp`]})]})]}):(0,X.jsx)(`p`,{className:`review-empty`,children:`Choose block or region select, then click the model.`})]}),(0,X.jsxs)(`section`,{children:[(0,X.jsxs)(`div`,{className:`review-section-heading`,children:[(0,X.jsx)(`span`,{className:`panel-kicker`,children:`Global audit`}),(0,X.jsxs)(`span`,{className:`review-heading-actions`,children:[(0,X.jsxs)(`small`,{children:[V.length,`/`,p.findings.length,` categories`]}),(0,X.jsx)($,{label:`Previous audit sample`,disabled:!H.length,onClick:()=>ze(-1),children:(0,X.jsx)(Se,{size:14})}),(0,X.jsx)($,{label:`Next audit sample`,disabled:!H.length,onClick:()=>ze(1),children:(0,X.jsx)(me,{size:14})})]})]}),(0,X.jsxs)(`div`,{className:`audit-totals`,children:[(0,X.jsxs)(`span`,{children:[(0,X.jsx)(`b`,{children:p.totals.errors}),` errors`]}),(0,X.jsxs)(`span`,{children:[(0,X.jsx)(`b`,{children:p.totals.warnings}),` warnings`]}),(0,X.jsxs)(`span`,{children:[(0,X.jsx)(`b`,{children:p.statefulPlacements.toLocaleString()}),` stateful`]})]}),(0,X.jsxs)(`div`,{className:`review-filter-row`,children:[(0,X.jsx)(rt,{size:13}),(0,X.jsx)(`input`,{"aria-label":`Filter audit findings`,value:ae,onChange:e=>v(t=>({...t,auditQuery:e.target.value,focusedFindingCode:void 0,focusedFindingIndex:void 0})),placeholder:`Filter code, message, coordinate`}),(0,X.jsxs)(`select`,{"aria-label":`Audit severity`,value:le,onChange:e=>v(t=>({...t,auditSeverity:e.target.value,focusedFindingCode:void 0,focusedFindingIndex:void 0})),children:[(0,X.jsx)(`option`,{value:`all`,children:`All severity`}),(0,X.jsx)(`option`,{value:`error`,children:`Errors`}),(0,X.jsx)(`option`,{value:`warning`,children:`Warnings`}),(0,X.jsx)(`option`,{value:`info`,children:`Info`})]})]}),(0,X.jsx)(`div`,{className:`audit-findings`,children:V.length?V.map(e=>(0,X.jsxs)(`article`,{className:y.focusedFindingCode===e.code?`active`:``,children:[(0,X.jsxs)(`button`,{type:`button`,className:`audit-finding-main`,disabled:!e.coordinates.length,onClick:()=>e.coordinates.length&&Re({finding:e,coordinate:e.coordinates[0],coordinateIndex:0}),children:[(0,X.jsx)(`span`,{className:`audit-dot ${e.severity}`}),(0,X.jsxs)(`span`,{children:[(0,X.jsx)(`strong`,{children:e.code.replaceAll(`_`,` `)}),(0,X.jsxs)(`small`,{children:[e.total.toLocaleString(),` affected · `,e.coordinates.length.toLocaleString(),` sampled`]}),(0,X.jsx)(`small`,{children:e.message})]}),e.coordinates.length?(0,X.jsx)($e,{size:13}):null]}),e.coordinates.length>0&&(0,X.jsxs)(`div`,{className:`audit-samples`,"aria-label":`${e.code} sampled coordinates`,children:[e.coordinates.slice(0,6).map((t,n)=>(0,X.jsx)(`button`,{type:`button`,className:y.focusedFindingCode===e.code&&y.focusedFindingIndex===n?`active`:``,onClick:()=>Re({finding:e,coordinate:t,coordinateIndex:n}),children:Z(t)},Z(t))),e.coordinates.length>6&&(0,X.jsxs)(`span`,{children:[`+`,e.coordinates.length-6,` more via next`]})]})]},e.code)):p.findings.length?(0,X.jsx)(`p`,{className:`review-empty`,children:`No audit categories match these filters.`}):(0,X.jsxs)(`div`,{className:`review-pass`,children:[(0,X.jsx)(we,{size:16}),`No structural audit findings`]})})]}),(0,X.jsxs)(`section`,{className:`review-history-section`,children:[(0,X.jsxs)(`div`,{className:`review-section-heading`,children:[(0,X.jsx)(`span`,{className:`panel-kicker`,children:`Annotation history`}),(0,X.jsxs)(`span`,{className:`review-heading-actions`,children:[(0,X.jsxs)(`small`,{children:[Q,` open · `,T.length-Q,` resolved`]}),M&&(0,X.jsxs)(`button`,{type:`button`,className:`review-text-button`,onClick:We,children:[(0,X.jsx)(ot,{size:12}),`Undo`]})]})]}),(0,X.jsxs)(`div`,{className:`review-filter-row`,children:[(0,X.jsx)(rt,{size:13}),(0,X.jsx)(`input`,{"aria-label":`Filter annotations`,value:ue,onChange:e=>v(t=>({...t,annotationQuery:e.target.value})),placeholder:`Filter notes, block, coordinate`}),(0,X.jsxs)(`select`,{"aria-label":`Annotation category`,value:fe,onChange:e=>v(t=>({...t,annotationCategory:e.target.value})),children:[(0,X.jsx)(`option`,{value:`all`,children:`All categories`}),st.map(e=>(0,X.jsx)(`option`,{value:e,children:e},e))]}),(0,X.jsxs)(`select`,{"aria-label":`Annotation status`,value:pe,onChange:e=>v(t=>({...t,annotationStatus:e.target.value})),children:[(0,X.jsx)(`option`,{value:`all`,children:`All status`}),(0,X.jsx)(`option`,{value:`open`,children:`Open`}),(0,X.jsx)(`option`,{value:`resolved`,children:`Resolved`})]})]}),(0,X.jsx)(`div`,{className:`review-history`,children:U.length?U.map(e=>(0,X.jsxs)(`article`,{className:e.resolved?`resolved`:``,children:[(0,X.jsxs)(`button`,{type:`button`,className:`review-history-focus`,onClick:()=>{let t=e.pickedBlock?f.placements.find(t=>t.block===e.pickedBlock&&t.x>=e.bounds.min.x&&t.x<=e.bounds.max.x&&t.y>=e.bounds.min.y&&t.y<=e.bounds.max.y&&t.z>=e.bounds.min.z&&t.z<=e.bounds.max.z):void 0;v(n=>({...n,selection:{...e.bounds,type:e.bounds.min.x===e.bounds.max.x&&e.bounds.min.y===e.bounds.max.y&&e.bounds.min.z===e.bounds.max.z?`block`:`region`,blockCount:e.blockCount,pickedBlock:e.pickedBlock,pickedState:e.pickedState,pickedPhase:t?.phase},anchor:void 0})),G(e.bounds)},children:[(0,X.jsx)(`i`,{style:{background:Tt[e.category]}}),(0,X.jsxs)(`span`,{children:[(0,X.jsxs)(`strong`,{children:[e.resolved?`Resolved · `:``,e.category,` · `,e.blockCount,` block`,e.blockCount===1?``:`s`]}),(0,X.jsx)(`small`,{children:e.note||Z(e.bounds.min)}),(0,X.jsxs)(`small`,{children:[Z(e.bounds.min),Ot(e.bounds.min,e.bounds.max)?``:` → ${Z(e.bounds.max)}`]})]})]}),(0,X.jsxs)(`div`,{className:`review-history-actions`,children:[(0,X.jsx)(`button`,{type:`button`,"aria-label":`Edit annotation ${e.note}`,title:`Edit annotation`,onClick:()=>He(e),children:(0,X.jsx)(tt,{size:13})}),(0,X.jsx)(`button`,{type:`button`,"aria-label":e.resolved?`Reopen annotation`:`Mark annotation resolved`,title:e.resolved?`Reopen`:`Mark resolved`,onClick:()=>Ge(e),children:e.resolved?(0,X.jsx)(nt,{size:13}):(0,X.jsx)(Je,{size:13})}),(0,X.jsx)(`button`,{type:`button`,"aria-label":`Delete annotation ${e.note}`,title:`Delete annotation`,onClick:()=>Ue(e),children:(0,X.jsx)(it,{size:13})})]})]},e.id)):T.length?(0,X.jsx)(`p`,{className:`review-empty`,children:`No annotations match these filters.`}):(0,X.jsx)(`p`,{className:`review-empty`,children:`No annotations yet.`})})]})]}),(0,X.jsxs)(`footer`,{className:`review-status`,children:[(0,X.jsxs)(`span`,{children:[(0,X.jsx)(`i`,{}),`Ready`]}),(0,X.jsx)(`span`,{children:b===`orbit`?`Orbit, pan, and zoom`:D?`Choose the second point`:`Review mode: ${b}`}),(0,X.jsx)(`span`,{children:je}),(0,X.jsxs)(`strong`,{children:[Ie.toLocaleString(),` visible · `,Q,` open · `,f.hash.slice(0,8)]}),(0,X.jsx)(_e,{size:16})]})]})}):(0,X.jsx)(u,{content:jt,children:(0,X.jsxs)(`section`,{className:`inline-summary review-inline`,children:[(0,X.jsx)(`div`,{className:`brand-cube`,children:(0,X.jsx)(_e,{size:22})}),(0,X.jsxs)(`div`,{children:[(0,X.jsxs)(`h2`,{children:[`Review `,f.input.name]}),(0,X.jsxs)(`p`,{children:[f.placements.length.toLocaleString(),` exact blocks · `,p.findings.length,` audit categories · `,T.length,` annotations`]})]}),(0,X.jsxs)(`button`,{className:`primary-button`,onClick:()=>s(`fullscreen`),children:[(0,X.jsx)(c,{size:16}),`Open reviewer`]})]})})}t((0,K.createElement)(zt));