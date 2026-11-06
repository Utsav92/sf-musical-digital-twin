import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/** Loads a user GLB/glTF city (e.g. exported from the Blender twin). Fails with readable messages. */
export async function loadGLB(file: File): Promise<THREE.Group> {
  if (!/\.(glb|gltf)$/i.test(file.name)) throw new Error(`Not a GLB/glTF file: ${file.name}`);
  const buf = await file.arrayBuffer();
  const loader = new GLTFLoader();
  const gltf = await new Promise<{ scene: THREE.Group }>((res, rej) => loader.parse(buf, "", res, (e) => rej(new Error(`GLB parse failed: ${(e as unknown as { message?: string }).message ?? String(e)}`))));
  const box = new THREE.Box3().setFromObject(gltf.scene);
  if (box.isEmpty()) throw new Error("GLB contains no renderable geometry.");
  const size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
  gltf.scene.position.sub(new THREE.Vector3(centre.x, box.min.y, centre.z)); // recentre on origin, sit on y=0
  gltf.scene.userData.sizeMetres = size.toArray(); // reported, NOT assumed to be metres: verify units in Blender export
  return gltf.scene;
}
