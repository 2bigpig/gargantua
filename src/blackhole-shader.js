/**
 * Raymarching shader for black hole visualization using Three.js TSL.
 */

import {
  vec2,
  vec3,
  vec4,
  float,
  Fn,
  length,
  normalize,
  cross,
  dot,
  sin,
  cos,
  atan,
  asin,
  sqrt,
  pow,
  fract,
  clamp,
  smoothstep,
  mix,
  floor,
  step,
  sign,
  abs,
  exp,
  Loop,
  Break,
  If,
  screenUV
} from 'three/tsl';

// Hash functions for pseudo-random number generation
const hash21 = Fn(([p]) => {
  const n = sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453);
  return fract(n);
});

const hash31 = Fn(([p]) => {
  const n = sin(dot(p, vec3(127.1, 311.7, 74.7))).mul(43758.5453);
  return fract(n);
});

const hash22 = Fn(([p]) => {
  const px = fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
  const py = fract(sin(dot(p, vec2(269.5, 183.3))).mul(43758.5453));
  return vec2(px, py);
});

// 3D value noise
const noise3D = Fn(([p]) => {
  const i = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));

  const a = hash31(i);
  const b = hash31(i.add(vec3(1, 0, 0)));
  const c = hash31(i.add(vec3(0, 1, 0)));
  const d = hash31(i.add(vec3(1, 1, 0)));
  const e = hash31(i.add(vec3(0, 0, 1)));
  const f2 = hash31(i.add(vec3(1, 0, 1)));
  const g = hash31(i.add(vec3(0, 1, 1)));
  const h = hash31(i.add(vec3(1, 1, 1)));

  return mix(
    mix(mix(a, b, u.x), mix(c, d, u.x), u.y),
    mix(mix(e, f2, u.x), mix(g, h, u.x), u.y),
    u.z
  );
});

// Fractal Brownian Motion - 4 octaves of layered noise
const fbm = Fn(([p, lacunarity, persistence]) => {
  const value = float(0.0).toVar();
  const amplitude = float(0.5).toVar();
  const pos = p.toVar();

  value.addAssign(noise3D(pos).mul(amplitude));
  pos.mulAssign(lacunarity);
  amplitude.mulAssign(persistence);

  value.addAssign(noise3D(pos).mul(amplitude));
  pos.mulAssign(lacunarity);
  amplitude.mulAssign(persistence);

  value.addAssign(noise3D(pos).mul(amplitude));
  pos.mulAssign(lacunarity);
  amplitude.mulAssign(persistence);

  value.addAssign(noise3D(pos).mul(amplitude));

  return value;
});

// 根据温度插值暖金到暖白，避免数百个查表分支挤占体积采样预算。
const blackbodyColor = Fn(([tempK]) => {
  const warm = mix(vec3(1.0, 0.27, 0.055), vec3(1.0, 0.74, 0.43), smoothstep(float(1200.0), float(4200.0), tempK));
  return mix(warm, vec3(0.93, 0.95, 1.0), smoothstep(float(4200.0), float(12000.0), tempK));
});

// Procedural star field using grid-based placement
const createStarField = (uniforms) => Fn(([rayDir]) => {
  const theta = atan(rayDir.z, rayDir.x);
  const phi = asin(clamp(rayDir.y, float(-1.0), float(1.0)));

  const gridScale = float(60.0).div(uniforms.starSize);
  const scaledCoord = vec2(theta, phi).mul(gridScale);
  const cell = floor(scaledCoord);
  const cellUV = fract(scaledCoord);

  const cellHash = hash21(cell);
  const starProb = step(float(1.0).sub(uniforms.starDensity), cellHash);

  const starPos = hash22(cell.add(42.0)).mul(0.8).add(0.1);
  const distToStar = length(cellUV.sub(starPos));

  const baseSizeVar = hash21(cell.add(100.0)).mul(0.03).add(0.01);
  const finalStarSize = baseSizeVar.mul(uniforms.starSize);

  const starCore = smoothstep(finalStarSize, float(0.0), distToStar);
  const starGlow = smoothstep(finalStarSize.mul(3.0), float(0.0), distToStar).mul(0.3);
  const starIntensity = starCore.add(starGlow).mul(starProb);

  const colorTemp = hash21(cell.add(200.0));
  const starColor = mix(vec3(0.8, 0.9, 1.0), vec3(1.0, 0.95, 0.8), colorTemp);

  return starColor.mul(starIntensity).mul(uniforms.starBrightness);
});

// Procedural nebula clouds - two FBM layers
const createNebulaField = (uniforms) => Fn(([rayDir]) => {
  const noisePos1 = rayDir.mul(uniforms.nebula1Scale);
  const n1 = fbm(noisePos1, float(2.0), float(0.5)).mul(2.0).sub(1.0);
  const layer1 = clamp(n1.add(uniforms.nebula1Density), float(0.0), float(1.0));
  const color1 = uniforms.nebula1Color.mul(layer1).mul(uniforms.nebula1Brightness);

  const noisePos2 = rayDir.mul(uniforms.nebula2Scale);
  const n2 = fbm(noisePos2, float(2.0), float(0.5)).mul(2.0).sub(1.0);
  const layer2 = clamp(n2.add(uniforms.nebula2Density), float(0.0), float(1.0));
  const color2 = uniforms.nebula2Color.mul(layer2).mul(uniforms.nebula2Brightness);

  return color1.add(color2);
});

// Accretion disk color with blackbody temperature, Doppler beaming, and turbulence
const createAccretionDiskColor = (uniforms) => Fn(([hitR, hitAngle, time, rayDir]) => {
  const innerR = uniforms.diskInnerRadius;
  const outerR = uniforms.diskOuterRadius;
  const normR = clamp(hitR.sub(innerR).div(outerR.sub(innerR)), float(0.0), float(1.0));

  // Temperature profile: T(r) = T_peak × (r_inner / r)^α
  // Inner disk is hotter (more gravitational energy released)
  // Standard thin disk model uses α ≈ 0.75
  const peakTempK = uniforms.diskTemperature.mul(1000.0);
  const tempK = peakTempK.mul(pow(innerR.div(hitR), uniforms.temperatureFalloff));
  const diskColor = blackbodyColor(tempK).toVar('diskColor');

  // Doppler beaming: D = 1/(1 - β·cos(θ)), brightness ∝ D³
  const rotationSign = sign(uniforms.diskRotationSpeed);
  const velocityDir = vec3(
    sin(hitAngle).negate().mul(rotationSign),
    float(0.0),
    cos(hitAngle).mul(rotationSign)
  );
  const velocityMagnitude = float(1.0).div(sqrt(hitR.div(innerR)));
  const beta = velocityMagnitude.mul(0.3);
  const cosTheta = dot(velocityDir, rayDir);
  const dopplerFactor = float(1.0).div(float(1.0).sub(beta.mul(cosTheta)));
  const dopplerBoost = pow(dopplerFactor, float(3.0).mul(uniforms.dopplerStrength));
  diskColor.mulAssign(clamp(dopplerBoost, float(0.1), float(5.0)));

  // Edge falloff
  const edgeFalloff = smoothstep(float(0.0), uniforms.diskEdgeSoftnessInner, normR)
    .mul(smoothstep(float(1.0), float(1.0).sub(uniforms.diskEdgeSoftnessOuter), normR));

  // Turbulent ring pattern with cyclic time to prevent winding artifacts
  const ringOpacity = float(1.0).toVar('ringOpacity');
  const cycleLength = uniforms.turbulenceCycleTime;
  const cyclicTime = time.mod(cycleLength);
  const blendFactor = cyclicTime.div(cycleLength);

  // Keplerian rotation: inner regions rotate faster (ω ∝ r^-1.5)
  const keplerianPhase1 = cyclicTime.mul(uniforms.diskRotationSpeed).div(pow(hitR, float(1.5)));
  const keplerianPhase2 = cyclicTime.add(cycleLength).mul(uniforms.diskRotationSpeed).div(pow(hitR, float(1.5)));
  const rotatedAngle1 = hitAngle.add(keplerianPhase1);
  const rotatedAngle2 = hitAngle.add(keplerianPhase2);

  // 粗犷气流：大块高反差气团扭曲较宽的流束，保留少量细丝，双相位连续。
  const gas = Fn(([angle]) => {
    const orbit = vec2(cos(angle), sin(angle));
    const warp = noise3D(vec3(orbit.mul(6.0), hitR.mul(0.6)));
    const radial = hitR.mul(1.15).add(warp.mul(1.65));
    const p = vec3(radial, orbit.mul(7.0));
    const coarse = noise3D(p);
    const fine = noise3D(p.mul(2.7));
    const clouds = noise3D(vec3(hitR.mul(0.55).add(warp.mul(0.65)), orbit.mul(5.0)));
    return pow(coarse.mul(0.3).add(fine.mul(0.08)).add(clouds.mul(0.62)).mul(1.45), 2.6).add(0.045);
  });
  ringOpacity.assign(mix(gas(rotatedAngle2), gas(rotatedAngle1), smoothstep(float(0.0), float(1.0), blendFactor)).clamp(0.03, 1.0));

  const finalOpacity = ringOpacity.mul(edgeFalloff);
  // 内缘炽亮、外缘逐渐消隐；亮度不依赖把透明度压成细黑线。
  const finalColor = diskColor.mul(uniforms.diskBrightness).mul(pow(innerR.div(hitR), 2.0)).mul(pow(ringOpacity, 1.6).mul(3.1).add(0.04));
  return vec4(finalColor, finalOpacity);
});

// 高斯积分的误差函数近似，避免细盘被步进跳过后出现规则条纹。
const gaussianIntegral = Fn(([x]) => {
  const v = clamp(x, float(-5.0), float(5.0));
  const shaped = v.mul(1.128379).add(v.mul(v).mul(v).mul(0.1));
  return float(2.0).div(float(1.0).add(exp(shaped.mul(-2.0)))).sub(1.0);
});

// Main raymarching shader
export function createBlackHoleShader(uniforms) {
  const starField = createStarField(uniforms);
  const nebulaField = createNebulaField(uniforms);
  const accretionDiskColor = createAccretionDiskColor(uniforms);

  return Fn(() => {
    const rs = uniforms.blackHoleMass.mul(2.0); // Schwarzschild radius

    // Camera setup
    // WebGPU 的 screenUV 纵坐标向下；保持参数与页面百分比一致。
    const uv = screenUV.sub(uniforms.screenCenter).mul(2.0);
    const aspect = uniforms.resolution.x.div(uniforms.resolution.y);
    const rawPos = vec2(uv.x.mul(aspect), uv.y.negate());
    const roll = uniforms.cameraRoll;
    const screenPos = vec2(rawPos.x.mul(cos(roll)).sub(rawPos.y.mul(sin(roll))), rawPos.x.mul(sin(roll)).add(rawPos.y.mul(cos(roll))));

    const camPos = uniforms.cameraPosition;
    const camTarget = uniforms.cameraTarget;
    const camForward = normalize(camTarget.sub(camPos));
    const worldUp = vec3(0.0, 1.0, 0.0);
    const camRight = normalize(cross(camForward, worldUp));
    const camUp = cross(camRight, camForward);

    const fov = uniforms.focalLength;
    const rayDir = normalize(
      camForward.mul(fov)
        .add(camRight.mul(screenPos.x))
        .add(camUp.mul(screenPos.y))
    ).toVar('rayDir');

    // Ray state
    const rayPos = camPos.toVar('rayPos');
    const prevPos = camPos.toVar('prevPos');
    const color = vec3(0.0, 0.0, 0.0).toVar('color');
    const alpha = float(0.0).toVar('alpha');
    const escaped = float(0.0).toVar('escaped');
    const captured = float(0.0).toVar('captured');

    const innerR = uniforms.diskInnerRadius;
    const outerR = uniforms.diskOuterRadius;

    // 守恒角动量的 Schwarzschild 射线积分；相比反平方近似，弯折光弧更自然。
    const angularMomentum = cross(rayPos, rayDir);
    const h2 = dot(angularMomentum, angularMomentum).toVar('angularMomentumSquared');

    // Raymarching loop
    // 放大的透镜光弧需要更多积分步，避免低分辨率截图式的锯齿。
    Loop(240, () => {
      If(escaped.greaterThan(0.5).or(captured.greaterThan(0.5)).or(alpha.greaterThan(0.99)), () => {
        Break();
      });

      const r = length(rayPos).toVar('radius');

      // Captured by black hole
      If(r.lessThan(rs.mul(1.01)), () => {
        captured.assign(1.0);
        Break();
      });

      // Escaped to infinity
      If(r.greaterThan(100.0), () => {
        escaped.assign(1.0);
        Break();
      });

      // Velocity Verlet 积分：近黑洞缩短步长，远处增大步长，不放大低清画面。
      const dt = clamp(r.mul(0.065), float(0.045), float(1.8)).toVar('rayStep');
      const acceleration = rayPos.mul(rs.mul(-1.5).mul(h2).div(pow(r, 5.0))).toVar('acceleration');
      prevPos.assign(rayPos);
      rayPos.addAssign(rayDir.mul(dt).add(acceleration.mul(dt.mul(dt).mul(0.5))));
      const nextR = length(rayPos);
      const nextAcceleration = rayPos.mul(rs.mul(-1.5).mul(h2).div(pow(nextR, 5.0)));
      rayDir.addAssign(acceleration.add(nextAcceleration).mul(dt.mul(0.5)));

      // 对射线段解析积分高斯厚度，不用稀疏点采样伪造细盘。
      const dy = rayPos.y.sub(prevPos.y).toVar('segmentY');
      const sampleT = clamp(prevPos.y.negate().div(dy.add(0.000001)), float(0.0), float(1.0));
      const samplePos = mix(prevPos, rayPos, sampleT).toVar('diskSample');
      const diskR = sqrt(samplePos.x.mul(samplePos.x).add(samplePos.z.mul(samplePos.z)));
      // 先排除盘外射线，仅在可能遇到气体的区间计算厚度噪声。
      If(diskR.greaterThan(innerR).and(diskR.lessThan(outerR)).and(abs(samplePos.y).lessThan(diskR.mul(0.17))), () => {
      // 空间连续的厚度扰动形成起伏边缘，不用闪烁噪声或规则条纹。
      const edgeCloud = noise3D(vec3(samplePos.x.mul(0.75), samplePos.z.mul(0.75), uniforms.time.mul(0.08)));
      const thickness = diskR.mul(0.026).mul(edgeCloud.mul(1.7).add(0.4)).max(0.05);
      If(abs(samplePos.y).lessThan(thickness.mul(3.0)), () => {
        const hitAngle = atan(samplePos.z, samplePos.x);
        const diskResult = accretionDiskColor(diskR, hitAngle, uniforms.time, normalize(rayDir));
        const integral = abs(gaussianIntegral(rayPos.y.div(thickness).mul(1.414214)).sub(gaussianIntegral(prevPos.y.div(thickness).mul(1.414214))));
        const pathDensity = integral.mul(thickness).mul(0.626657).div(abs(dy).max(0.00001)).mul(dt);
        const opticalDepth = diskResult.w.mul(pathDensity).mul(2.2);
        const opacity = float(1.0).sub(exp(opticalDepth.negate()));
        const remainingAlpha = float(1.0).sub(alpha);
        color.addAssign(diskResult.xyz.mul(opacity).mul(remainingAlpha));
        alpha.addAssign(remainingAlpha.mul(opacity));
      });
      });
    });

    If(captured.lessThan(0.5), () => {
      escaped.assign(1.0);
    });

    // Background for escaped rays
    If(escaped.greaterThan(0.5).and(alpha.lessThan(0.99)), () => {
      const bgColor = uniforms.starBackgroundColor.toVar('bgColor');

      If(uniforms.starsEnabled.greaterThan(0.5), () => {
        bgColor.addAssign(starField(rayDir));
      });

      If(uniforms.nebulaEnabled.greaterThan(0.5), () => {
        bgColor.addAssign(nebulaField(rayDir));
      });

      color.addAssign(bgColor.mul(float(1.0).sub(alpha)));
    });

    // 色调在渲染器统一映射，不重复施加伽马。
    const finalColor = color;
    // 压低橙色饱和度，保留随温度和湍流变化的暖白、浅金层次。
    const neutral = vec3(dot(finalColor, vec3(0.2126, 0.7152, 0.0722)));
    const cinematicColor = mix(finalColor, neutral, float(0.2)).mul(vec3(1.0, 0.97, 0.91));
    return vec4(cinematicColor, 1.0);
  })();
}

