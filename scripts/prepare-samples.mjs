import { runtimeUrl, runtimeDependency } from './runtime-paths.mjs';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { rename } from 'node:fs/promises';

const sharp = runtimeDependency('sharp');
const root = runtimeUrl('samples/');
await mkdir(root, { recursive: true });

const revision = '90d7ede14c7e280af263824604b427a1ca02cb66';
const userAgent = 'LearningObservatoryPOC/0.1 (local teaching resource validation)';
const maxAssetBytes = 64 * 1024 * 1024;
const sha = buffer => createHash('sha256').update(buffer).digest('hex');
const cc0Url = 'https://creativecommons.org/publicdomain/zero/1.0/';
const ccByUrl = 'https://creativecommons.org/licenses/by/4.0/';

async function download(url, file, max = maxAssetBytes) {
  try {
    return await readFile(new URL(file, root));
  } catch {
    // The runtime cache is intentionally reusable across repeated preparation runs.
  }
  const pending = new URL(`${file}.download`, root);
  await promisify(execFile)(
    process.platform === 'win32' ? 'curl.exe' : 'curl',
    [
      '--fail', '--silent', '--show-error', '--location', '--proto', '=https',
      '--proto-redir', '=https', '--max-redirs', '3', '--retry', '2',
      '--max-time', '180', '--max-filesize', String(max), '--user-agent', userAgent,
      '--output', fileURLToPath(pending), url,
    ],
    { windowsHide: true },
  );
  const bytes = await readFile(pending);
  if (bytes.length > max) throw new Error(`Asset ${file} is over the bounded sample size`);
  await rename(pending, new URL(file, root));
  console.log(`Downloaded ${file}: ${bytes.length} bytes`);
  return bytes;
}

const modelConfigs = [
  {
    id: 'AntiqueCamera', file: 'antique-camera.glb', title: '古董相机 · 光学仪器', category: '物理工程', creator: 'UX3D', license: 'CC0-1.0',
    attribution: 'Antique Camera — UX3D · CC0 1.0 · Khronos glTF Sample Assets',
    description: '旋转观察镜头、机身与调节部件的相对位置，适合开展光学仪器和机械结构的入门观察。', noteTitle: '镜头与机身', noteBody: '找到镜头、镜筒和机身，比较它们在成像和支撑中的作用。',
  },
  {
    id: 'Avocado', file: 'avocado.glb', title: '牛油果 · 果实剖面', category: '自然科学', creator: 'Microsoft', license: 'CC0-1.0',
    attribution: 'Avocado — Microsoft · CC0 1.0 · Khronos glTF Sample Assets',
    description: '旋转观察外皮、果肉与种子的相对位置。模型来自绘制贴图的数字样例，不作为精确解剖或尺寸依据。', noteTitle: '从外到内', noteBody: '找到外皮、果肉与中央种子。比较三者的形态与表面特征。',
  },
  {
    id: 'BarramundiFish', file: 'barramundi.glb', title: '尖吻鲈 · 鱼体形态', category: '自然科学', creator: 'Microsoft', license: 'CC0-1.0',
    attribution: 'BarramundiFish — Microsoft · CC0 1.0 · Khronos glTF Sample Assets',
    description: '观察身体轮廓、各鳍位置与尾部形态；比较从侧面和正面看到的结构。此模型用于外形观察，不替代生物标本鉴定。', noteTitle: '观察运动结构', noteBody: '找出胸鳍、背鳍和尾鳍。尝试从形态推测它们在游动中的作用。',
  },
  {
    id: 'BoomBox', file: 'boombox.glb', title: '便携音箱 · 声学设备', category: '物理工程', creator: 'Public', license: 'CC0-1.0',
    attribution: 'BoomBox — Public · CC0 1.0 · Khronos glTF Sample Assets',
    description: '观察扬声器单元、旋钮、提手和外壳的布局，用于声学设备和产品结构的基础认识。', noteTitle: '声音从哪里出来', noteBody: '找出扬声器单元和控制旋钮，思考外壳为什么需要包住内部结构。',
  },
  {
    id: 'CarConcept', file: 'car-concept.glb', title: '概念汽车 · 交通工程', category: '物理工程', creator: 'Darmstadt Graphics Group GmbH', license: 'CC-BY-4.0',
    attribution: 'Car Concept — Darmstadt Graphics Group GmbH · CC BY 4.0 · Khronos glTF Sample Assets',
    description: '从不同角度观察车身、车轮、车窗和外形曲面，适合讨论交通工具的形态与空气阻力。', noteTitle: '车轮与车身', noteBody: '比较车轮、车身和驾驶舱的空间关系，记录它们如何共同支持移动。',
  },
  {
    id: 'CesiumMan', file: 'cesium-man.glb', title: '数字人体 · 姿态观察', category: '人体与健康', creator: 'Cesium', license: 'CC-BY-4.0',
    attribution: 'CesiumMan — Cesium · CC BY 4.0 · Khronos glTF Sample Assets',
    description: '用于观察数字人体的站立姿态、四肢比例和关节连接；不用于医学诊断或真实人体测量。', noteTitle: '关节连接', noteBody: '观察肩、肘、髋、膝和踝的位置，描述四肢如何围绕关节活动。',
  },
  {
    id: 'CesiumMilkTruck', file: 'cesium-milk-truck.glb', title: '奶罐车 · 运输结构', category: '物理工程', creator: 'Cesium', license: 'CC-BY-4.0',
    attribution: 'CesiumMilkTruck — Cesium · CC BY 4.0 · Khronos glTF Sample Assets',
    description: '观察驾驶室、车厢、车轮和底盘的布局，讨论运输工具如何承载和移动货物。', noteTitle: '承载与移动', noteBody: '先找到车厢和底盘，再观察车轮如何支撑车辆并传递运动。',
  },
  {
    id: 'ChronographWatch', file: 'chronograph-watch.glb', title: '计时码表 · 精密机械', category: '物理工程', creator: 'graphiccompressor、Darmstadt Graphics Group GmbH', license: 'CC-BY-4.0',
    attribution: 'Chronograph Watch — graphiccompressor、Darmstadt Graphics Group GmbH · CC BY 4.0 · Khronos glTF Sample Assets',
    description: '观察表盘、表冠、按键和表带结构，适合进行精密仪器和人机操作部件的空间观察。', noteTitle: '操作部件', noteBody: '找到表冠和计时按键，比较它们与表盘、表壳之间的空间关系。',
  },
  {
    id: 'Corset', file: 'corset.glb', title: '紧身胸衣 · 服装结构', category: '人体与健康', creator: 'UX3D', license: 'CC0-1.0',
    attribution: 'Corset — UX3D · CC0 1.0 · Khronos glTF Sample Assets',
    description: '观察服装外形、骨条与系带的排列，讨论服装如何围绕人体形成支撑和约束。', noteTitle: '支撑线条', noteBody: '寻找纵向骨条和系带，比较它们对服装形状的影响。',
  },
  {
    id: 'Fox', file: 'fox.glb', title: '狐狸 · 动物形态', category: '自然科学', creator: 'tomkranis、Asobo Studio、scurest', license: 'CC-BY-4.0',
    attribution: 'Fox — tomkranis、Asobo Studio、scurest · CC BY 4.0 / CC0 components · Khronos glTF Sample Assets',
    description: '观察头部、躯干、四肢和尾部的整体比例，用于动物形态与运动姿态的基础观察。', noteTitle: '形态与运动', noteBody: '比较四肢和尾部的方向，思考它们如何配合奔跑和保持平衡。',
  },
  {
    id: 'Lantern', file: 'lantern.glb', title: '提灯 · 光源设备', category: '生活与工程', creator: 'Microsoft、Frank Galligan', license: 'CC0-1.0',
    attribution: 'Lantern — Microsoft、Frank Galligan · CC0 1.0 · Khronos glTF Sample Assets',
    description: '观察提手、外壳、玻璃罩和底座，适合讨论光源保护、携带和通风结构。', noteTitle: '保护光源', noteBody: '找到提手、保护框和透明罩，分析它们如何兼顾携带与透光。',
  },
  {
    id: 'SunglassesKhronos', file: 'sunglasses-khronos.glb', title: '太阳镜 · 视觉防护', category: '人体与健康', creator: 'Darmstadt Graphics Group GmbH、Khronos Group', license: 'CC-BY-4.0',
    attribution: 'SunglassesKhronos — Darmstadt Graphics Group GmbH、Khronos Group · CC BY 4.0 · Khronos glTF Sample Assets',
    description: '观察镜片、镜框、鼻托和镜腿的连接方式，用于视觉防护用品的人机结构观察。', noteTitle: '贴合面部', noteBody: '从正面和侧面观察镜片、鼻托、镜腿的位置，思考它们如何贴合面部。',
  },
  {
    id: 'ToyCar', file: 'toy-car.glb', title: '玩具车 · 轮式结构', category: '物理工程', creator: 'Public', license: 'CC0-1.0',
    attribution: 'ToyCar — Public · CC0 1.0 · Khronos glTF Sample Assets',
    description: '观察轮子、车轴和车身的关系，用较低复杂度模型理解轮式运动的基本结构。', noteTitle: '车轴与轮子', noteBody: '找到车轴和四个轮子，描述它们如何配合让车身前进。',
  },
  {
    id: 'WaterBottle', file: 'water-bottle.glb', title: '水瓶 · 容器结构', category: '生活与工程', creator: 'Public', license: 'CC0-1.0',
    attribution: 'WaterBottle — Public · CC0 1.0 · Khronos glTF Sample Assets',
    description: '观察瓶身、瓶口、瓶盖和底部支撑结构，适合开展容器设计和材料形态的基础讨论。', noteTitle: '容纳与密封', noteBody: '比较瓶身和瓶盖的形状，思考它们如何共同完成容纳和密封。',
  },
];

const samples = [];
for (const config of modelConfigs) {
  const downloadUrl = `https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/${revision}/Models/${config.id}/glTF-Binary/${config.id}.glb`;
  const evidenceUrl = `https://github.com/KhronosGroup/glTF-Sample-Assets/blob/${revision}/Models/${config.id}/README.md`;
  const bytes = await download(downloadUrl, config.file);
  const hash = sha(bytes);
  const licenseDescription = config.license === 'CC0-1.0'
    ? '已核对该模型 README 的逐件 Legal 声明：CC0 1.0；保留作者、原始资源页与许可链接。'
    : '已核对该模型 README 的逐件 Legal 声明：CC BY 4.0 或其明确列出的兼容组件；保留作者、原始资源页与许可链接。';
  samples.push({
    key: `khronos-${config.id}`,
    file: config.file,
    downloadUrl,
    sourceRevision: revision,
    originalSha256: hash,
    evidenceUrl,
    reviewNote: licenseDescription,
    metadata: {
      title: config.title,
      kind: 'model',
      description: config.description,
      category: config.category,
      creator: config.creator,
      sourceName: 'Khronos glTF Sample Assets',
      sourceAssetId: config.id,
      sourceSha256: hash,
      sourceUrl: evidenceUrl,
      license: config.license,
      licenseUrl: config.license === 'CC0-1.0' ? cc0Url : ccByUrl,
      attribution: config.attribution,
      modifications: '模型文件未修改；教学名称与观察提示由本地观察台补充。',
      rightsConfirmed: true,
      originalFileName: config.file,
    },
    notes: [{ id: randomUUID(), title: config.noteTitle, body: config.noteBody }],
  });
}

const panoramaConfigs = [
  { id: 'aviation_museum', file: 'aviation-museum.jpg', title: '航空博物馆 · 飞行器环境', category: '历史与工程', description: '在固定观察点环顾展厅，观察飞机、展柜、地面和顶部空间的关系。', noteTitle: '展陈空间', noteBody: '记录大型飞行器与展厅尺度之间的关系，比较近景与远景的视觉变化。' },
  { id: 'aircraft_workshop_01', file: 'aircraft-workshop-01.jpg', title: '飞机维修车间 · 工程现场', category: '历史与工程', description: '观察维修车间中的设备、机体和工作空间，理解大型工程维护的现场环境。', noteTitle: '维护现场', noteBody: '寻找机体、工具和工作区域，思考维护人员如何围绕目标组织空间。' },
  { id: 'abandoned_bakery', file: 'abandoned-bakery.jpg', title: '废弃面包房 · 空间遗迹', category: '社会与环境', description: '环顾废弃室内空间，观察墙面、设备、门窗和光线留下的环境线索。', noteTitle: '环境线索', noteBody: '找出仍能说明房间用途的设备或布局，区分观察到的事实与推测。' },
  { id: 'autumn_forest_01', file: 'autumn-forest-01.jpg', title: '秋季森林 · 植被观察', category: '生态环境', description: '观察不同方向的林冠、树干、地表和光线，进行季节性生态环境记录。', noteTitle: '林冠与地表', noteBody: '分别描述树冠层、树干层和地表层的颜色、密度与明暗。' },
  { id: 'bamboo_tunnel', file: 'bamboo-tunnel.jpg', title: '竹林通道 · 植物空间', category: '生态环境', description: '环顾竹林通道，观察茎秆密度、叶片遮挡和通道空间的方向性。', noteTitle: '密度与方向', noteBody: '比较通道两侧竹秆的方向和密度，描述它们如何塑造视线。' },
  { id: 'beach_cloudy_bridge', file: 'beach-cloudy-bridge.jpg', title: '海滩云桥 · 海岸环境', category: '地理环境', description: '观察海岸、天空、云层和桥体之间的空间关系，进行环境与天气观察。', noteTitle: '海天交界', noteBody: '找到海平面、沙地和桥体，描述不同方向上的空间层次。' },
  { id: 'bank_vault', file: 'bank-vault.jpg', title: '银行金库 · 安全空间', category: '社会与工程', description: '观察金库门、墙体、地面和内部空间，理解高安全场所的环境特征。', noteTitle: '防护结构', noteBody: '观察厚重门体、门框和周围墙体，记录哪些结构表现出防护目的。' },
  { id: 'bathroom', file: 'bathroom.jpg', title: '浴室 · 室内设施', category: '生活与工程', description: '环顾浴室中的洁具、墙面、地面与照明，观察生活空间的功能分区。', noteTitle: '功能分区', noteBody: '指出用水、排水、收纳和照明相关的设施，说明它们如何分布。' },
  { id: 'aerodynamics_workshop', file: 'aerodynamics-workshop.jpg', title: '空气动力学车间 · 实验环境', category: '物理工程', description: '观察实验车间内的设备、工作台和测试空间，为工程实验场景建立空间感。', noteTitle: '实验空间', noteBody: '区分测试区域、操作区域和通行区域，描述它们之间的关系。' },
  { id: 'alps_field', file: 'alps-field.jpg', title: '阿尔卑斯山地草场 · 地形观察', category: '地理环境', description: '观察山地草场、山体、天空和地表起伏，进行自然地理环境的方向性记录。', noteTitle: '远近地形', noteBody: '比较脚下草场、中景坡面和远处山体的轮廓与色调。' },
  { id: 'forest_slope', file: 'forest-slope.jpg', outputWidth: 4096, title: '林间坡地 · 环境观察', category: '生态环境', description: '转向四周、抬头与低头，观察树冠、林下地面、坡度和光线的关系。这个球形全景从单一拍摄位置环顾现场，不支持在林间自由走动。', noteTitle: '林下层次', noteBody: '观察近处地表、树干和远处树冠，比较不同距离上的遮挡与光照。' },
  { id: 'old_hall', file: 'old-hall.jpg', title: '旧大厅 · 建筑空间', category: '历史与建筑', description: '观察旧建筑内部的柱、墙、地面、门窗和顶部结构，建立建筑空间的整体感知。', noteTitle: '建筑骨架', noteBody: '寻找承重或分隔空间的主要构件，描述它们如何组织大厅。' },
  { id: 'kloofendal_48d_partly_cloudy_puresky', file: 'kloofendal-partly-cloudy.jpg', title: '山谷草地 · 天空与地表', category: '地理环境', description: '观察开阔山谷中的地表、植被、云层和远景，用于自然环境的多方向观察。', noteTitle: '开阔视野', noteBody: '分别观察地面、地平线和天空，记录开阔环境中的主要参照物。' },
  { id: 'moonlit_golf', file: 'moonlit-golf.jpg', title: '月光球场 · 夜间环境', category: '地理环境', description: '观察月光下的草地、树木、建筑和天空，体验低照度环境中的空间辨识。', noteTitle: '夜间光线', noteBody: '找出月光方向和最亮区域，比较夜间环境与白天观察的差异。' },
  { id: 'small_hangar_01', file: 'small-hangar-01.jpg', title: '小型机库 · 航空空间', category: '历史与工程', description: '环顾小型机库，观察机体、地面、墙体和工作区域的组合。', noteTitle: '机库尺度', noteBody: '以机体为参照，估计机库的宽度、净高和通行空间。' },
  { id: 'urban_courtyard', file: 'urban-courtyard.jpg', title: '城市庭院 · 建成环境', category: '社会与环境', description: '观察城市庭院中的建筑立面、地面、植物和通道，理解日常建成环境。', noteTitle: '人行路径', noteBody: '寻找主要通行方向和停留区域，描述建筑、植物与路径的关系。' },
];

for (const config of panoramaConfigs) {
  const apiResponse = await fetch(`https://api.polyhaven.com/files/${config.id}`, { headers: { 'User-Agent': userAgent }, signal: AbortSignal.timeout(20000) });
  if (!apiResponse.ok) throw new Error(`Poly Haven API returned ${apiResponse.status} for ${config.id}`);
  const files = await apiResponse.json();
  const infoResponse = await fetch(`https://api.polyhaven.com/info/${config.id}`, { headers: { 'User-Agent': userAgent }, signal: AbortSignal.timeout(20000) });
  if (!infoResponse.ok) throw new Error(`Poly Haven metadata returned ${infoResponse.status} for ${config.id}`);
  const info = await infoResponse.json();
  const source = files.tonemapped;
  if (!source?.url || new URL(source.url).hostname !== 'dl.polyhaven.org') throw new Error(`Unexpected Poly Haven download host for ${config.id}`);
  if (source.size && source.size > maxAssetBytes) throw new Error(`Poly Haven source ${config.id} is over the bounded sample size`);
  const originalFile = `${config.id}-original.jpg`;
  const original = await download(source.url, originalFile);
  if ((source.size && source.size !== original.length) || createHash('md5').update(original).digest('hex') !== source.md5) throw new Error(`Poly Haven integrity check failed for ${config.id}`);
  const image = sharp(original, { limitInputPixels: 250000000 });
  const dimensions = await image.metadata();
  if (dimensions.width !== dimensions.height * 2) throw new Error(`Expected a full equirectangular panorama for ${config.id}`);
  const outputWidth = config.outputWidth ?? 2048;
  const derivative = await image.resize({ width: outputWidth, height: outputWidth / 2, fit: 'fill' }).jpeg({ quality: 90 }).toBuffer();
  try { await stat(new URL(config.file, root)); } catch { await writeFile(new URL(config.file, root), derivative, { flag: 'wx' }); }
  const authors = Object.keys(info.authors ?? {});
  const creator = authors.join('、') || 'Poly Haven contributors';
  const hash = sha(original);
  samples.push({
    key: `polyhaven-${config.id}`,
    file: config.file,
    downloadUrl: source.url,
    evidenceUrl: 'https://polyhaven.com/license',
    originalSha256: hash,
    apiMd5: source.md5,
    reviewNote: '已核对 Poly Haven 资产许可：CC0，可保存及再分发；按 API 条款保留 Poly Haven 来源名称。',
    metadata: {
      title: config.title,
      kind: 'panorama',
      description: config.description,
      category: config.category,
      creator,
      sourceName: 'Poly Haven',
      sourceAssetId: config.id,
      sourceSha256: hash,
      sourceUrl: `https://polyhaven.com/a/${config.id}`,
      license: 'CC0-1.0',
      licenseUrl: cc0Url,
      attribution: `${config.title} — ${authors.join(', ') || 'Poly Haven contributors'} · Poly Haven · CC0 1.0`,
      modifications: `原始 ${dimensions.width}×${dimensions.height} 全景等比缩小为 ${outputWidth}×${outputWidth / 2} JPG，未合成或添加场景。`,
      rightsConfirmed: true,
      originalFileName: config.file,
    },
    notes: [{ id: randomUUID(), title: config.noteTitle, body: config.noteBody, position: { yaw: 0, pitch: -0.15 } }],
  });
}

await writeFile(new URL('manifest.json', root), JSON.stringify({ retrievedAt: new Date().toISOString(), sampleCount: samples.length, samples }, null, 2), 'utf8');
console.log(`Prepared ${samples.length} actual resources: ${modelConfigs.length} glTF models and ${panoramaConfigs.length} 360 panoramas, with per-resource license records.`);
