// Provider taxonomy is authoritative; material tags like "wood" do not make a chair a specimen.
export function modelTopic(info) {
  const root=(info.category??'').split('/')[0];
  const topics={
    Nature:['自然标本','旋转观察表面、分枝或结构层次；模型不替代物种鉴定。'],
    Furniture:['器物与家具','旋转观察家具的支撑、连接方式与功能关系。'],
    Architecture:['建筑构件','观察构件形态、连接位置与材质，比较正面和侧面。'],
    'Electronics & Appliances':['仪器与设备','观察外部部件、形态和连接关系；模型不作为操作或维修指南。'],
    'Tools & Equipment':['工具与机械','观察部件连接、把持位置和形态，不把模型用作操作规程。'],
    'Industrial & Infrastructure':['工具与机械','观察工业构件的形态与连接关系，不把模型用作施工或操作规程。'],
    'Food & Kitchen':['生活与食物','观察整体轮廓和表面纹理，比较不同方向的形状。'],
    Lighting:['光照与灯具','观察灯具外形、支撑和光源位置，不推断未显示的内部结构。'],
    'Vehicles & Transport':['交通与运输','观察外部结构和部件位置；模型不作为精确尺寸或驾驶操作依据。'],
    Leisure:['运动与休闲','比较各部分形状与日常用途之间的关系。'],
    Weapons:['器物与工艺','观察外形、材料和制作工艺，仅作形态与文化观察。'],
  };
  return topics[root]??['日常器物','从多个方向观察器物的形态、材质及功能关系。'];
}
