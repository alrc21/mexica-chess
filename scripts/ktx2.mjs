// GPU-compressed textures: a baked GLB (from blender/out) → public/models with
// KTX2 textures (Basis Universal) and meshopt geometry. Normal maps go UASTC
// (sharp, no block artefacts on carving), colour and ORM go ETC1S (small).
// They stay compressed on the GPU: a 2K set costs half the VRAM of a 1K webp set.
// Measured 2026-10-20: king 2.5 MB, pawn 2.1 MB per file (webp 1K: ~0.5 MB) —
// kept for the mobile pass, where VRAM matters more than download.
// Needs KTX2Loader + /basis transcoder at runtime. UASTC=1 for UASTC normals (~5 MB).
//   node scripts/ktx2.mjs <in.glb> <out.glb> [size=2048]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, textureCompress } from '@gltf-transform/functions';
import { ktx2 } from 'ktx2-encoder/gltf-transform';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const [input, output, size = '2048'] = process.argv.slice(2);
const imageDecoder = async buffer => {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
};
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.decoder': MeshoptDecoder,
  'meshopt.encoder': MeshoptEncoder,
});
const doc = await io.read(input);
const n = Number(size);
await doc.transform(
  dedup(),
  prune({ keepAttributes: true }),
  // Resize first (lossless PNG), then encode each slot its own way.
  textureCompress({ encoder: sharp, targetFormat: 'png', resize: [n, n] }),
  process.env.UASTC
    ? ktx2({ slots: /normalTexture/, isUASTC: true, isNormalMap: true, isPerceptual: false, enableRDO: true, rdoQualityLevel: 4, needSupercompression: true, generateMipmap: true, isKTX2File: true, imageDecoder })
    : ktx2({ slots: /normalTexture/, isUASTC: false, isNormalMap: true, qualityLevel: 255, compressionLevel: 4, isPerceptual: false, generateMipmap: true, isKTX2File: true, imageDecoder }),
  ktx2({ slots: /baseColorTexture/, isUASTC: false, qualityLevel: 200, compressionLevel: 2, isPerceptual: true, isSetKTX2SRGBTransferFunc: true, generateMipmap: true, isKTX2File: true, imageDecoder }),
  ktx2({ slots: /occlusionTexture|metallicRoughnessTexture/, isUASTC: false, qualityLevel: 160, compressionLevel: 2, isPerceptual: false, generateMipmap: true, isKTX2File: true, imageDecoder }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);
await io.write(output, doc);
