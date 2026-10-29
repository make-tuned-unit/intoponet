/* A single-pass, dependency-free WebGL illustration. Signal locations are art,
   not live data. NASA Black Marble texture is shared with the browser. */
window.createIntoponetGlobe = function (canvas) {
  const gl = canvas.getContext('webgl', { alpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
  if (!gl) return null;
  const vertex = `attribute vec2 position; void main(){ gl_Position=vec4(position,0.,1.); }`;
  const fragment = `precision mediump float;
    uniform vec2 resolution;
    uniform vec2 pointer;
    uniform float time;
    uniform float signals;
    uniform sampler2D earth;
    const float PI=3.14159265;
    mat2 rotate(float a){return mat2(cos(a),-sin(a),sin(a),cos(a));}
    float peak(vec3 p, vec3 center, float scale){return exp(-dot(p-center,p-center)*scale);}
    void main(){
      vec2 uv=(gl_FragCoord.xy-.5*resolution)/min(resolution.x,resolution.y)*2.;
      uv.y+=.04;
      float radius=.79;
      float r=length(uv);
      vec3 teal=vec3(.22,.86,.76);
      vec3 blue=vec3(.27,.43,.93);
      float atmosphere=exp(-max(r-radius,0.)*24.)*.33;
      float halo=exp(-abs(r-radius)*65.)*.32;
      vec3 color=mix(blue,teal,smoothstep(-.9,.8,uv.y))*(atmosphere*.32+halo);
      float alpha=atmosphere*.4+halo;
      if(r<radius){
        vec3 n=vec3(uv/radius,sqrt(max(0.,1.-r*r/(radius*radius))));
        vec3 p=n;
        p.yz=rotate(-.16+pointer.y*.09)*p.yz;
        p.xz=rotate(.4+time*.025+pointer.x*.16)*p.xz;
        vec2 tex=vec2(atan(p.x,p.z)/(2.*PI)+.5,asin(clamp(p.y,-1.,1.))/PI+.5);
        vec3 surface=texture2D(earth,tex).rgb;
        float light=max(dot(n,normalize(vec3(-.7,.8,1.))),0.);
        float rim=pow(1.-n.z,3.);
        color=vec3(.018,.043,.065)+surface*vec3(.7,.92,1.2)*(.7+light*.9);
        color+=teal*rim*.2+blue*pow(1.-n.z,6.)*.65;
        float field=peak(p,normalize(vec3(.1,.75,.65)),19.)
          +.8*peak(p,normalize(vec3(-.85,.5,.15)),24.)
          +.85*peak(p,normalize(vec3(.8,.35,.3)),22.)
          +.65*peak(p,normalize(vec3(-.55,-.4,.7)),26.)
          +.65*peak(p,normalize(vec3(.35,-.65,.65)),22.);
        float ripple=sin(p.x*16.+time*.24)*sin(p.y*14.-time*.18)*.025;
        float line=pow(.5+.5*cos((field+ripple)*115.-time*.3),22.);
        float density=smoothstep(.035,.2,field);
        color+=mix(teal,vec3(.59,.55,1.),smoothstep(.45,.95,field))*line*density*.58*signals*(.35+.65*n.z);
        float lat=pow(abs(cos(asin(p.y)*18.)),170.);
        float lon=pow(abs(cos(atan(p.x,p.z)*18.)),170.);
        color+=vec3(.16,.32,.35)*(lat+lon)*.07;
        float pulse=pow(.5+.5*sin(field*38.-time*1.3),12.);
        color+=teal*pulse*pow(field,9.)*.3*signals;
        color*=.65+.35*light;
        alpha=1.;
      }
      // Fine elliptical orbital arcs keep the globe suspended in space.
      vec2 orbit=rotate(-.32)*uv;
      float ellipse=length(vec2(orbit.x/1.05,orbit.y/.35));
      float ring=(1.-smoothstep(.001,.006,abs(ellipse-1.)));
      float front=step(orbit.y,0.)+step(radius,r);
      color+=teal*ring*.15*min(front,1.);
      alpha=max(alpha,ring*.2*min(front,1.));
      gl_FragColor=vec4(color,clamp(alpha,0.,1.));
    }`;
  function shader(type, source) {
    const result = gl.createShader(type);
    gl.shaderSource(result, source); gl.compileShader(result);
    return result;
  }
  const program = gl.createProgram();
  const vs = shader(gl.VERTEX_SHADER, vertex), fs = shader(gl.FRAGMENT_SHADER, fragment);
  gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('Globe illustration unavailable:', gl.getProgramInfoLog(program), gl.getShaderInfoLog(fs));
    gl.deleteProgram(program); gl.deleteShader(vs); gl.deleteShader(fs); return null;
  }
  gl.deleteShader(vs); gl.deleteShader(fs); gl.useProgram(program);
  const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
  const attr = gl.getAttribLocation(program, 'position'); gl.enableVertexAttribArray(attr); gl.vertexAttribPointer(attr, 2, gl.FLOAT, false, 0, 0);
  const uniforms = Object.fromEntries(['resolution','pointer','time','signals'].map(name => [name, gl.getUniformLocation(program, name)]));
  const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([5,12,18,255]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  let ready = false, lost = false, last = [0,0,0,1];
  const image = new Image();
  image.onload = () => {
    if (lost) return;
    gl.bindTexture(gl.TEXTURE_2D, texture); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    ready = true; canvas.parentElement.classList.add('globe-ready'); draw(...last);
  };
  image.src = '/assets/earth.jpg';
  function resize() {
    const box = canvas.getBoundingClientRect();
    const ratio = Math.min(devicePixelRatio || 1, 1.5);
    canvas.width = Math.max(1, Math.round(box.width*ratio)); canvas.height = Math.max(1, Math.round(box.height*ratio));
    gl.viewport(0,0,canvas.width,canvas.height); draw(...last);
  }
  function draw(t,x,y,signal) {
    last = [t,x,y,signal];
    if (!ready || lost) return;
    gl.uniform2f(uniforms.resolution,canvas.width,canvas.height);
    gl.uniform2f(uniforms.pointer,x,y); gl.uniform1f(uniforms.time,t); gl.uniform1f(uniforms.signals,signal);
    gl.drawArrays(gl.TRIANGLES,0,6);
  }
  canvas.addEventListener('webglcontextlost', () => { lost = true; canvas.parentElement.classList.remove('globe-ready'); });
  new ResizeObserver(resize).observe(canvas);
  resize();
  return { draw };
};
