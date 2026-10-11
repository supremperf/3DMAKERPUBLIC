import * as THREE from "three";
import type { SceneNode } from "../types";

/** FBX 7.4 ASCII natif : géométrie, transformations, normales, UV, matériaux et textures intégrées. */
export function exportFBX(nodes: SceneNode[]): string {
  let id = 100000;
  const objects: string[] = [];
  const connections: string[] = [];
  let textures = 0;
  const quote = (value: string) => value.replace(/["\r\n]/g, "_");
  const numbers = (values: number[]) =>
    values
      .map((v) => (Number.isFinite(v) ? Number(v.toFixed(8)) : 0))
      .join(",");
  const property = (name: string, type: string, value: string) =>
    `\t\t\tP: "${name}", "${type}", "", "A",${value}\n`;
  for (const node of nodes) {
    if (!node.geometry) continue;
    const geometryId = id++,
      modelId = id++,
      materialId = id++;
    const g = node.geometry;
    const vertexIndices =
      g.indices || Array.from({ length: g.positions.length / 3 }, (_, i) => i);
    const polygonIndices = vertexIndices.map((v, i) =>
      i % 3 === 2 ? -v - 1 : v,
    );
    const normals: number[] = [],
      uvIndices: number[] = [];
    const normalData = g.normals;
    const computed = new THREE.BufferGeometry();
    computed.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(g.positions, 3),
    );
    computed.setIndex(vertexIndices);
    if (!normalData) computed.computeVertexNormals();
    const normalAttribute = computed.getAttribute("normal");
    for (const index of vertexIndices) {
      normals.push(
        ...(normalData
          ? normalData.slice(index * 3, index * 3 + 3)
          : [
              normalAttribute.getX(index),
              normalAttribute.getY(index),
              normalAttribute.getZ(index),
            ]),
      );
      uvIndices.push(index);
    }
    objects.push(`\tGeometry: ${geometryId}, "Geometry::${quote(node.name)}", "Mesh" {
\t\tVertices: *${g.positions.length} {
\t\t\ta: ${numbers(g.positions)}
\t\t}
\t\tPolygonVertexIndex: *${polygonIndices.length} {
\t\t\ta: ${numbers(polygonIndices)}
\t\t}
\t\tGeometryVersion: 124
\t\tLayerElementNormal: 0 {
\t\t\tVersion: 101
\t\t\tName: ""
\t\t\tMappingInformationType: "ByPolygonVertex"
\t\t\tReferenceInformationType: "Direct"
\t\t\tNormals: *${normals.length} {
\t\t\t\ta: ${numbers(normals)}
\t\t\t}
\t\t}
${
  g.uvs
    ? `\t\tLayerElementUV: 0 {
\t\t\tVersion: 101
\t\t\tName: "UVChannel_1"
\t\t\tMappingInformationType: "ByPolygonVertex"
\t\t\tReferenceInformationType: "IndexToDirect"
\t\t\tUV: *${g.uvs.length} {
\t\t\t\ta: ${numbers(g.uvs)}
\t\t\t}
\t\t\tUVIndex: *${uvIndices.length} {
\t\t\t\ta: ${numbers(uvIndices)}
\t\t\t}
\t\t}
`
    : ""
}\t\tLayerElementMaterial: 0 {
\t\t\tVersion: 101
\t\t\tName: ""
\t\t\tMappingInformationType: "AllSame"
\t\t\tReferenceInformationType: "IndexToDirect"
\t\t\tMaterials: *1 {
\t\t\t\ta: 0
\t\t\t}
\t\t}
\t\tLayer: 0 {
\t\t\tVersion: 100
\t\t\tLayerElement: {
\t\t\t\tType: "LayerElementNormal"
\t\t\t\tTypedIndex: 0
\t\t\t}
${
  g.uvs
    ? `\t\t\tLayerElement: {
\t\t\t\tType: "LayerElementUV"
\t\t\t\tTypedIndex: 0
\t\t\t}
`
    : ""
}\t\t\tLayerElement: {
\t\t\t\tType: "LayerElementMaterial"
\t\t\t\tTypedIndex: 0
\t\t\t}
\t\t}
\t}`);
    objects.push(`\tModel: ${modelId}, "Model::${quote(node.name)}", "Mesh" {
\t\tVersion: 232
\t\tProperties70: {
${property("Lcl Translation", "Lcl Translation", numbers(node.transform.position))}${property("Lcl Rotation", "Lcl Rotation", numbers(node.transform.rotation.map(THREE.MathUtils.radToDeg)))}${property("Lcl Scaling", "Lcl Scaling", numbers(node.transform.scale))}\t\t}
\t\tShading: T
\t\tCulling: "CullingOff"
\t}`);
    const color = new THREE.Color(node.material.color).convertLinearToSRGB();
    const emission = new THREE.Color(
      node.material.emissive,
    ).convertLinearToSRGB();
    objects.push(`\tMaterial: ${materialId}, "Material::${quote(node.name)}", "" {
\t\tVersion: 102
\t\tShadingModel: "phong"
\t\tMultiLayer: 0
\t\tProperties70: {
${property("DiffuseColor", "Color", numbers([color.r, color.g, color.b]))}${property("EmissiveColor", "Color", numbers([emission.r, emission.g, emission.b]))}${property("EmissiveFactor", "Number", String(node.material.emissiveIntensity))}${property("Shininess", "Number", String((1 - node.material.roughness) * 100))}${property("ReflectionFactor", "Number", String(node.material.metalness))}${property("TransparencyFactor", "Number", String(1 - node.material.opacity))}\t\t}
\t}`);
    connections.push(
      `\tC: "OO",${geometryId},${modelId}`,
      `\tC: "OO",${materialId},${modelId}`,
      `\tC: "OO",${modelId},0`,
    );
    const slots: Record<string, string> = {
      map: "DiffuseColor",
      normalMap: "NormalMap",
      roughnessMap: "ShininessExponent",
      metalnessMap: "ReflectionFactor",
      emissiveMap: "EmissiveColor",
      aoMap: "AmbientColor",
    };
    for (const [slot, data] of Object.entries(node.material.textures)) {
      const match = data?.match(/^data:image\/(\w+);base64,(.*)$/s);
      if (!match) continue;
      const videoId = id++,
        textureId = id++,
        filename = `${quote(node.name)}-${slot}.${match[1] === "jpeg" ? "jpg" : match[1]}`;
      textures++;
      objects.push(`\tVideo: ${videoId}, "Video::${filename}", "Clip" {
\t\tType: "Clip"
\t\tFilename: "${filename}"
\t\tRelativeFilename: "${filename}"
\t\tContent: ,
\t\t\t"${match[2]}"
\t}`);
      objects.push(`\tTexture: ${textureId}, "Texture::${filename}", "" {
\t\tType: "TextureVideoClip"
\t\tVersion: 202
\t\tTextureName: "Texture::${filename}"
\t\tMedia: "Video::${filename}"
\t\tFileName: "${filename}"
\t\tRelativeFilename: "${filename}"
\t\tModelUVTranslation: 0,0
\t\tModelUVScaling: 1,1
\t\tTexture_Alpha_Source: "None"
\t\tCropping: 0,0,0,0
\t}`);
      connections.push(
        `\tC: "OO",${videoId},${textureId}`,
        `\tC: "OP",${textureId},${materialId},"${slots[slot]}"`,
      );
    }
    computed.dispose();
  }
  return `; FBX 7.4.0 project file — 3DMAKER
FBXHeaderExtension: {
\tFBXHeaderVersion: 1003
\tFBXVersion: 7400
\tCreator: "3DMAKER 1.0"
}
GlobalSettings: {
\tVersion: 1000
\tProperties70: {
\t\tP: "UpAxis", "int", "Integer", "",1
\t\tP: "UpAxisSign", "int", "Integer", "",1
\t\tP: "FrontAxis", "int", "Integer", "",2
\t\tP: "FrontAxisSign", "int", "Integer", "",-1
\t\tP: "CoordAxis", "int", "Integer", "",0
\t\tP: "CoordAxisSign", "int", "Integer", "",1
\t\tP: "UnitScaleFactor", "double", "Number", "",100
\t}
}
Definitions: {
\tVersion: 100
\tCount: ${objects.length}
\tObjectType: "Geometry" {
\t\tCount: ${nodes.filter((n) => n.geometry).length}
\t}
\tObjectType: "Model" {
\t\tCount: ${nodes.filter((n) => n.geometry).length}
\t}
\tObjectType: "Material" {
\t\tCount: ${nodes.filter((n) => n.geometry).length}
\t}
\tObjectType: "Texture" {
\t\tCount: ${textures}
\t}
\tObjectType: "Video" {
\t\tCount: ${textures}
\t}
}
Objects: {
${objects.join("\n")}
}
Connections: {
${connections.join("\n")}
}
`;
}
