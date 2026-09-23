// Actual GLB rendering, loaded only by uploaders/maintenance, never by catalog browsing.
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {DRACOLoader} from 'three/addons/loaders/DRACOLoader.js';
import {KTX2Loader} from 'three/addons/loaders/KTX2Loader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';

export function createThumbnailRenderer() {
  const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true,alpha:false});
  renderer.setSize(480,360);renderer.setPixelRatio(1);
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=0.95;
  const studio=new RoomEnvironment();const pmrem=new THREE.PMREMGenerator(renderer);
  const environment=pmrem.fromScene(studio,0.04);studio.dispose();pmrem.dispose();
  const draco=new DRACOLoader().setDecoderPath('/learn/thumbnail-vendor/draco/').setWorkerLimit(1);
  const ktx=new KTX2Loader().setTranscoderPath('/learn/thumbnail-vendor/basis/').detectSupport(renderer).setWorkerLimit(1);
  const manager=new THREE.LoadingManager();
  // The upload validator requires self-contained GLB; do not fetch embedded external URLs.
  manager.setURLModifier(url=>{if(!/^(blob:|data:)/.test(url))throw new Error('模型包含外部文件，无法生成预览。');return url;});
  const loader=new GLTFLoader(manager).setDRACOLoader(draco).setKTX2Loader(ktx).setMeshoptDecoder(MeshoptDecoder);
  const disposeModel=(model:THREE.Object3D)=>{
    const textures=new Set<THREE.Texture>();const materials=new Set<THREE.Material>();
    model.traverse((object:any)=>{
      object.geometry?.dispose();
      for(const material of (Array.isArray(object.material)?object.material:[object.material]).filter(Boolean)){
        materials.add(material);for(const value of Object.values(material))if((value as any)?.isTexture)textures.add(value as THREE.Texture);
      }
    });
    for(const texture of textures){(texture.image as any)?.close?.();texture.dispose();}
    for(const material of materials)material.dispose();
  };
  return {
    async render(assetUrl:string):Promise<Blob> {
      if(!/^\/scenes\/lr-[a-f0-9-]{36}\/model\.glb$/.test(assetUrl))throw new Error('模型地址不正确。');
      const response=await fetch(assetUrl,{signal:AbortSignal.timeout(60000)});
      if(!response.ok)throw new Error('模型无法读取，请登录后重试。');
      const gltf=await loader.parseAsync(await response.arrayBuffer(),'');
      const scene=new THREE.Scene();scene.background=new THREE.Color('#edf1ee');scene.environment=environment.texture;scene.environmentIntensity=0.7;
      scene.add(gltf.scene);gltf.scene.updateMatrixWorld(true);
      try {
        const bounds=new THREE.Box3().setFromObject(gltf.scene,true);
        if(bounds.isEmpty())throw new Error('模型没有可见内容。');
        const center=bounds.getCenter(new THREE.Vector3());const size=bounds.getSize(new THREE.Vector3());
        const radius=size.length()/2;
        if(!Number.isFinite(radius)||radius<=0)throw new Error('模型尺寸不正确。');
        // Preserve original geometry, material, transparency and orientation; move only the camera.
        const camera=new THREE.PerspectiveCamera(32,4/3,Math.max(radius/1000,0.00001),radius*100);
        const direction=new THREE.Vector3(0.42,0.22,1).normalize();
        const right=new THREE.Vector3().crossVectors(camera.up,direction).normalize();
        const up=new THREE.Vector3().crossVectors(direction,right).normalize();
        const tangent=Math.tan(THREE.MathUtils.degToRad(16));
        let distance=0;
        for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){
          const corner=new THREE.Vector3(x,y,z).sub(center);
          distance=Math.max(distance,corner.dot(direction)+Math.max(Math.abs(corner.dot(right))/(tangent*camera.aspect),Math.abs(corner.dot(up))/tangent)*1.12);
        }
        camera.position.copy(center).add(direction.multiplyScalar(distance));
        camera.lookAt(center);
        scene.add(new THREE.HemisphereLight(0xffffff,0x7b8580,1.4));
        const key=new THREE.DirectionalLight(0xffffff,2);key.position.copy(center).add(new THREE.Vector3(radius*2,radius*3,radius*4));
        key.target.position.copy(center);scene.add(key,key.target);
        renderer.render(scene,camera);
        // White, thin or translucent anatomy can disappear on a pale studio background.
        // Compare actual rendered pixels; change only the background, never model materials.
        const pixels=new Uint8Array(480*360*4);const gl=renderer.getContext();
        const contrast=()=>{
          gl.readPixels(0,0,480,360,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
          let peak=0;
          for(let c=0;c<3;c++){let sum=0,squares=0;for(let i=c;i<pixels.length;i+=4){sum+=pixels[i];squares+=pixels[i]**2;}const n=pixels.length/4;peak=Math.max(peak,Math.sqrt(Math.max(0,squares/n-(sum/n)**2)));}
          return peak;
        };
        if(contrast()<12){scene.background.set('#36413c');renderer.render(scene,camera);}
        return await new Promise<Blob>((resolve,reject)=>renderer.domElement.toBlob(blob=>blob?resolve(blob):reject(new Error('截图未生成，请重试。')),'image/jpeg',0.88));
      }finally{disposeModel(gltf.scene);renderer.renderLists.dispose();}
    },
    dispose(){draco.dispose();ktx.dispose();environment.dispose();renderer.dispose();renderer.forceContextLoss();}
  };
}
