import { brushedNormalTexture } from "../engine/texturePresets";
import { useEffect, useState } from "react";
import {
  SlidersHorizontal,
  Sparkles,
  Box,
  Lightbulb,
  Camera,
  Link2,
  Unlink2,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  MoreHorizontal,
  ImagePlus,
  X,
  Settings2,
  Plus,
  Cuboid,
  Palette,
} from "lucide-react";
import { useEditor } from "../store/editor";
import { triangleCount } from "../engine/geometry";
import { chooseFiles, readAsDataURL } from "../services/bridge";
import {
  Button,
  ColorField,
  EmptyState,
  IconButton,
  NumberInput,
  RangeInput,
  Section,
  Toggle,
} from "./common";
import { AIPanel } from "./AIPanel";
import { BackgroundPanel } from "./BackgroundPanel";
import { SimpleInspector } from "./SimpleInspector";
import { useWorkspace } from "../store/workspace";
import {
  DEFAULT_MATERIAL,
  type MaterialData,
  type TextureSlot,
  type Vec3,
} from "../types";

const presets: {
  name: string;
  color: string;
  roughness: number;
  metalness: number;
  className: string;
}[] = [
  {
    name: "Argile",
    color: "#e3d8c5",
    roughness: 0.8,
    metalness: 0,
    className: "clay",
  },
  {
    name: "Acier",
    color: "#bac3ce",
    roughness: 0.22,
    metalness: 1,
    className: "steel",
  },
  {
    name: "Or",
    color: "#d3a94f",
    roughness: 0.23,
    metalness: 1,
    className: "gold",
  },
  {
    name: "Verre",
    color: "#bde3dc",
    roughness: 0.04,
    metalness: 0,
    className: "glass",
  },
];
const textureLabels: Record<TextureSlot, string> = {
  map: "Albédo",
  normalMap: "Normale",
  roughnessMap: "Rugosité",
  metalnessMap: "Métal",
  emissiveMap: "Émission",
  aoMap: "Occlusion",
};
function VectorFields({
  label,
  values,
  onChange,
  rotation = false,
  scale = false,
  disabled = false,
}: {
  label: string;
  values: Vec3;
  onChange: (index: number, value: number) => void;
  rotation?: boolean;
  scale?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="vector-field">
      <span className="field-label">
        {label}
        <small>{rotation ? "°" : scale ? "" : "m"}</small>
      </span>
      <div className="vector-inputs">
        {values.map((value, i) => (
          <label className="vector-component" key={i}>
            <span className={`axis-label axis-${["x", "y", "z"][i]}`}>
              {["X", "Y", "Z"][i]}
            </span>
            <NumberInput
              value={rotation ? (value * 180) / Math.PI : value}
              onChange={(v) => onChange(i, rotation ? (v * Math.PI) / 180 : v)}
              label={`${label} ${["X", "Y", "Z"][i]}`}
              step={rotation ? 1 : scale ? 0.1 : 0.01}
              min={-10000}
              disabled={disabled}
            />
          </label>
        ))}
      </div>
    </div>
  );
}
export function PropertiesPanel() {
  const panel = useEditor((s) => s.panel);
  const expert = useWorkspace((s) => s.expert);
  return (
    <aside className="properties-panel">
      <div className="inspector-tabs">
        <button
          className={panel === "properties" ? "active" : ""}
          onClick={() => useEditor.setState({ panel: "properties" })}
        >
          <SlidersHorizontal size={14} />
          Objet
        </button>
        <button
          className={panel === "background" ? "active" : ""}
          onClick={() => useEditor.setState({ panel: "background" })}
        >
          <Palette size={14} />
          Fond
        </button>
        <button
          className={panel === "ai" ? "active" : ""}
          onClick={() => useEditor.setState({ panel: "ai" })}
        >
          <Sparkles size={14} />
          Assistant
          <span className="tiny-ai-dot" />
        </button>
      </div>
      {panel === "ai" ? (
        <AIPanel />
      ) : panel === "background" ? (
        <BackgroundPanel />
      ) : expert ? (
        <Inspector />
      ) : (
        <SimpleInspector />
      )}
    </aside>
  );
}
function Inspector() {
  const document = useEditor((s) => s.document);
  const selection = useEditor((s) => s.selection);
  const [linked, setLinked] = useState(false);
  const [name, setName] = useState("");
  const node = document.nodes.find((n) => n.id === selection[0]);
  const s = useEditor.getState();
  const disabled = !!node?.locked;
  const multiple = selection.length > 1;
  useEffect(() => {
    setName(node?.name || "");
  }, [node?.id, node?.name]);
  const patchMaterial = (patch: Partial<MaterialData>) =>
    s.patchSelected(
      (n) => ({ ...n, material: { ...n.material, ...patch } }),
      "Modifier le matériau",
    );
  const transform = (
    field: "position" | "rotation" | "scale",
    index: number,
    value: number,
  ) => {
    s.patchSelected(
      (n) => {
        const vector = [...n.transform[field]] as Vec3;
        if (field === "scale" && Math.abs(value) < 0.0001)
          value = value < 0 ? -0.0001 : 0.0001;
        if (field === "scale" && linked) {
          const ratio =
            value / (Math.abs(vector[index]) < 0.0001 ? 0.0001 : vector[index]);
          for (let i = 0; i < 3; i++) vector[i] *= ratio;
        } else vector[index] = value;
        return { ...n, transform: { ...n.transform, [field]: vector } };
      },
      `Modifier ${field === "position" ? "la position" : field === "rotation" ? "la rotation" : "l’échelle"}`,
    );
  };
  const importTexture = async (slot: TextureSlot) => {
    try {
      const [file] = await chooseFiles(".png,.jpg,.jpeg,.hdr");
      if (!file) return;
      if (file.size > 32 * 1024 * 1024)
        throw new Error("Texture limitée à 32 Mo.");
      if (!/\.(png|jpe?g|hdr)$/i.test(file.name))
        throw new Error("Choisissez un PNG, JPG ou HDR.");
      const url = await readAsDataURL(
        file.name.toLowerCase().endsWith(".hdr")
          ? new Blob([file], { type: "image/vnd.radiance" })
          : file,
      );
      s.patchSelected(
        (n) => ({
          ...n,
          material: {
            ...n.material,
            textures: { ...n.material.textures, [slot]: url },
          },
        }),
        "Importer une texture",
      );
    } catch (e) {
      s.notify((e as Error).message, "error");
    }
  };
  const patchLight = (patch: Partial<NonNullable<typeof node>["light"]>) =>
    s.patchSelected(
      (n) => (n.light ? { ...n, light: { ...n.light, ...patch } } : n),
      "Modifier la lumière",
    );
  return (
    <div className="inspector-scroll">
      {node ? (
        <>
          <div className="object-heading">
            <span className={`object-avatar ${node.kind}`}>
              {node.kind === "mesh" ? (
                <Box size={22} strokeWidth={1.4} />
              ) : node.kind === "light" ? (
                <Lightbulb size={22} />
              ) : (
                <Camera size={22} />
              )}
            </span>
            <div>
              <h3>
                {multiple
                  ? `${selection.length} objets sélectionnés`
                  : node.name}
              </h3>
              <p>
                {multiple
                  ? "Propriétés communes"
                  : node.geometry
                    ? `Maillage · ${triangleCount(node.geometry).toLocaleString("fr-FR")} triangles`
                    : node.light
                      ? "Éclairage de scène"
                      : "Caméra de scène"}
              </p>
            </div>
            <IconButton
              icon={MoreHorizontal}
              label="Paramètres de modélisation"
              onClick={() =>
                s.openDialog(node.geometry ? "advanced" : "render", "align")
              }
            />
          </div>
          <div className="object-name-row">
            <label>
              <span className="field-label">Nom de l’objet</span>
              <input
                aria-label="Nom de l’objet sélectionné"
                value={name}
                disabled={multiple}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => {
                  if (name.trim() && name !== node.name)
                    s.patchNode(
                      node.id,
                      { name: name.trim().slice(0, 120) },
                      "Renommer l’objet",
                    );
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") setName(node.name);
                }}
              />
            </label>
            <IconButton
              icon={node.visible ? Eye : EyeOff}
              label={node.visible ? "Masquer l’objet" : "Afficher l’objet"}
              onClick={() =>
                s.patchNode(
                  node.id,
                  { visible: !node.visible },
                  "Changer la visibilité",
                )
              }
            />
            <IconButton
              icon={node.locked ? Lock : Unlock}
              label={
                node.locked ? "Déverrouiller l’objet" : "Verrouiller l’objet"
              }
              active={node.locked}
              onClick={() =>
                s.patchNode(
                  node.id,
                  { locked: !node.locked },
                  "Verrouiller l’objet",
                )
              }
            />
          </div>
          {disabled && (
            <div className="inline-note">
              <Lock size={12} />
              Objet verrouillé. Déverrouillez-le pour éditer.
            </div>
          )}
          <Section
            title="TRANSFORMATION"
            trailing={
              <IconButton
                icon={linked ? Link2 : Unlink2}
                label={
                  linked
                    ? "Désactiver l’échelle uniforme"
                    : "Lier les axes de l’échelle"
                }
                active={linked}
                onClick={() => setLinked(!linked)}
              />
            }
          >
            <VectorFields
              label="Position"
              values={node.transform.position}
              onChange={(i, v) => transform("position", i, v)}
              disabled={disabled}
            />
            <VectorFields
              label="Rotation"
              values={node.transform.rotation}
              rotation
              onChange={(i, v) => transform("rotation", i, v)}
              disabled={disabled}
            />
            <VectorFields
              label="Échelle"
              values={node.transform.scale}
              scale
              onChange={(i, v) => transform("scale", i, v)}
              disabled={disabled}
            />
            <button
              className="text-button transform-reset"
              disabled={disabled}
              onClick={() =>
                s.patchSelected(
                  (n) => ({
                    ...n,
                    transform: {
                      position: [0, 0, 0],
                      rotation: [0, 0, 0],
                      scale: [1, 1, 1],
                    },
                  }),
                  "Réinitialiser les transformations",
                )
              }
            >
              Réinitialiser les transformations
            </button>
          </Section>
          {node.geometry && (
            <>
              <Section
                title="MATÉRIAU"
                trailing={<span className="section-label">PBR</span>}
              >
                <div className="material-heading">
                  <span
                    className="material-orb"
                    style={
                      {
                        "--material-color": node.material.color,
                      } as React.CSSProperties
                    }
                  />
                  <div>
                    <strong>Matériau de surface</strong>
                    <small>Physiquement réaliste</small>
                  </div>
                  <button
                    className="text-button"
                    disabled={disabled}
                    title="Réinitialiser le matériau"
                    onClick={() =>
                      patchMaterial(structuredClone(DEFAULT_MATERIAL))
                    }
                  >
                    Réinit.
                  </button>
                </div>
                <ColorField
                  label="Albédo"
                  value={node.material.color}
                  onChange={(color) => patchMaterial({ color })}
                  disabled={disabled}
                />
                <RangeInput
                  label="Rugosité"
                  value={node.material.roughness}
                  onChange={(roughness) => patchMaterial({ roughness })}
                  disabled={disabled}
                />
                <RangeInput
                  label="Métallique"
                  value={node.material.metalness}
                  onChange={(metalness) => patchMaterial({ metalness })}
                  disabled={disabled}
                />
                <div className="presets-label">MATÉRIAUX RAPIDES</div>
                <div className="material-presets">
                  {presets.map((preset) => (
                    <button
                      key={preset.name}
                      disabled={disabled}
                      title={`Appliquer le matériau ${preset.name}`}
                      onClick={() =>
                        s.patchSelected((n) => {
                          const textures = { ...n.material.textures };
                          if (preset.name === "Acier")
                            textures.normalMap = brushedNormalTexture();
                          else if (
                            textures.normalMap === brushedNormalTexture()
                          )
                            delete textures.normalMap;
                          return {
                            ...n,
                            material: {
                              ...n.material,
                              color: preset.color,
                              roughness: preset.roughness,
                              metalness: preset.metalness,
                              opacity: 1,
                              transmission: preset.name === "Verre" ? 0.98 : 0,
                              thickness: 0.2,
                              ior: 1.5,
                              clearcoat: 0,
                              anisotropy: preset.name === "Acier" ? 0.85 : 0,
                              normalScale:
                                preset.name === "Acier"
                                  ? 0.35
                                  : n.material.normalScale,
                              doubleSided: false,
                              textures,
                            },
                          };
                        }, `Matériau ${preset.name}`)
                      }
                    >
                      <span className={`preset-orb ${preset.className}`} />
                      <span>{preset.name}</span>
                    </button>
                  ))}
                </div>
              </Section>
              <Section title="TEXTURES & DÉTAILS" defaultOpen={false}>
                <div className="texture-slots">
                  {(Object.keys(textureLabels) as TextureSlot[]).map((slot) => (
                    <div className="texture-row" key={slot}>
                      <span className="texture-preview">
                        {node.material.textures[slot] &&
                        !node.material.textures[slot]!.startsWith(
                          "data:image/vnd.radiance",
                        ) ? (
                          <img
                            alt={`Texture ${textureLabels[slot]}`}
                            src={node.material.textures[slot]}
                          />
                        ) : (
                          <ImagePlus size={13} />
                        )}
                      </span>
                      <span>{textureLabels[slot]}</span>
                      <button
                        className="text-button"
                        disabled={disabled}
                        onClick={() => void importTexture(slot)}
                      >
                        {node.material.textures[slot] ? "Changer" : "Importer"}
                      </button>
                      {node.material.textures[slot] && (
                        <IconButton
                          icon={X}
                          label={`Retirer la texture ${textureLabels[slot]}`}
                          disabled={disabled}
                          onClick={() =>
                            s.patchSelected((n) => {
                              const textures = { ...n.material.textures };
                              delete textures[slot];
                              return {
                                ...n,
                                material: { ...n.material, textures },
                              };
                            }, "Retirer une texture")
                          }
                        />
                      )}
                    </div>
                  ))}
                </div>
                <ColorField
                  label="Émission"
                  value={node.material.emissive}
                  onChange={(emissive) => patchMaterial({ emissive })}
                  disabled={disabled}
                />
                <RangeInput
                  label="Intensité d’émission"
                  min={0}
                  max={10}
                  value={node.material.emissiveIntensity}
                  onChange={(emissiveIntensity) =>
                    patchMaterial({ emissiveIntensity })
                  }
                  disabled={disabled}
                />
                <RangeInput
                  label="Opacité"
                  value={node.material.opacity}
                  onChange={(opacity) => patchMaterial({ opacity })}
                  disabled={disabled}
                />
                <RangeInput
                  label="Transmission (verre)"
                  value={node.material.transmission}
                  onChange={(transmission) => patchMaterial({ transmission })}
                  disabled={disabled}
                />
                <label className="form-row">
                  <span>Indice de réfraction</span>
                  <NumberInput
                    label="Indice de réfraction"
                    value={node.material.ior}
                    min={1}
                    max={2.333}
                    step={0.01}
                    disabled={disabled}
                    onChange={(ior) => patchMaterial({ ior })}
                  />
                </label>
                <label className="form-row">
                  <span>Épaisseur optique (m)</span>
                  <NumberInput
                    label="Épaisseur optique"
                    value={node.material.thickness}
                    min={0}
                    max={10000}
                    step={0.01}
                    disabled={disabled}
                    onChange={(thickness) => patchMaterial({ thickness })}
                  />
                </label>
                <RangeInput
                  label="Vernis"
                  value={node.material.clearcoat}
                  onChange={(clearcoat) => patchMaterial({ clearcoat })}
                  disabled={disabled}
                />
                <RangeInput
                  label="Anisotropie (brossage)"
                  value={node.material.anisotropy}
                  onChange={(anisotropy) => patchMaterial({ anisotropy })}
                  disabled={disabled}
                />
                <RangeInput
                  label="Force normale"
                  max={3}
                  value={node.material.normalScale}
                  onChange={(normalScale) => patchMaterial({ normalScale })}
                  disabled={disabled}
                />
                <RangeInput
                  label="Occlusion"
                  max={3}
                  value={node.material.aoIntensity}
                  onChange={(aoIntensity) => patchMaterial({ aoIntensity })}
                  disabled={disabled}
                />
                <Toggle
                  label="Faces recto-verso"
                  value={node.material.doubleSided}
                  onChange={(doubleSided) => patchMaterial({ doubleSided })}
                  disabled={disabled}
                />
                <Toggle
                  label="Ombrage plat"
                  value={node.material.flatShading}
                  onChange={(flatShading) => patchMaterial({ flatShading })}
                  disabled={disabled}
                />
              </Section>
            </>
          )}
          {node.light && (
            <Section title="ÉCLAIRAGE">
              <label className="form-row">
                <span>Type</span>
                <select
                  value={node.light.type}
                  disabled={disabled}
                  onChange={(e) =>
                    patchLight({
                      type: e.target.value as typeof node.light.type,
                    })
                  }
                >
                  <option value="ambient">Ambiante</option>
                  <option value="directional">Directionnelle</option>
                  <option value="point">Ponctuelle</option>
                  <option value="spot">Projecteur</option>
                </select>
              </label>
              <ColorField
                label="Couleur"
                value={node.light.color}
                onChange={(color) => patchLight({ color })}
                disabled={disabled}
              />
              <label className="form-row">
                <span>Intensité</span>
                <NumberInput
                  label="Intensité de la lumière"
                  value={node.light.intensity}
                  onChange={(intensity) => patchLight({ intensity })}
                  min={0}
                  max={10000}
                  disabled={disabled}
                />
              </label>
              {["point", "spot"].includes(node.light.type) && (
                <label className="form-row">
                  <span>Portée (m)</span>
                  <NumberInput
                    label="Portée de la lumière"
                    value={node.light.distance}
                    min={0}
                    onChange={(distance) => patchLight({ distance })}
                    disabled={disabled}
                  />
                </label>
              )}
              {node.light.type === "spot" && (
                <>
                  <RangeInput
                    label="Angle (°)"
                    value={node.light.angle}
                    min={1}
                    max={89}
                    step={1}
                    onChange={(angle) => patchLight({ angle })}
                    disabled={disabled}
                  />
                  <RangeInput
                    label="Pénombre"
                    value={node.light.penumbra}
                    onChange={(penumbra) => patchLight({ penumbra })}
                    disabled={disabled}
                  />
                </>
              )}
              {["spot", "directional"].includes(node.light.type) && (
                <VectorFields
                  label="Cible"
                  values={node.light.target}
                  onChange={(i, v) => {
                    const target = [...node.light!.target] as Vec3;
                    target[i] = v;
                    patchLight({ target });
                  }}
                  disabled={disabled}
                />
              )}
              <Toggle
                label="Projeter des ombres"
                value={node.light.castShadow}
                onChange={(castShadow) => patchLight({ castShadow })}
                disabled={disabled}
              />
            </Section>
          )}
          {node.camera && (
            <Section title="CAMÉRA">
              <RangeInput
                label="Champ de vision (°)"
                min={5}
                max={150}
                value={node.camera.fov}
                onChange={(fov) =>
                  s.patchNode(
                    node.id,
                    { camera: { ...node.camera!, fov } },
                    "Modifier la caméra",
                  )
                }
                disabled={disabled}
              />
              <VectorFields
                label="Cible"
                values={node.camera.target}
                onChange={(i, v) => {
                  const target = [...node.camera!.target] as Vec3;
                  target[i] = v;
                  s.patchNode(
                    node.id,
                    { camera: { ...node.camera!, target } },
                    "Modifier la caméra",
                  );
                }}
                disabled={disabled}
              />
              <label className="form-row">
                <span>Plan proche</span>
                <NumberInput
                  value={node.camera.near}
                  label="Plan proche"
                  min={0.001}
                  max={node.camera.far - 0.01}
                  onChange={(near) =>
                    s.patchNode(
                      node.id,
                      { camera: { ...node.camera!, near } },
                      "Modifier la caméra",
                    )
                  }
                />
              </label>
              <label className="form-row">
                <span>Plan lointain</span>
                <NumberInput
                  value={node.camera.far}
                  label="Plan lointain"
                  min={node.camera.near + 0.01}
                  max={100000}
                  onChange={(far) =>
                    s.patchNode(
                      node.id,
                      { camera: { ...node.camera!, far } },
                      "Modifier la caméra",
                    )
                  }
                />
              </label>
              <Button icon={Camera} onClick={() => s.focus("camera", node.id)}>
                Regarder par cette caméra
              </Button>
            </Section>
          )}
        </>
      ) : (
        <div className="no-selection">
          <EmptyState icon={Cuboid} title="Tout commence par une forme">
            Sélectionnez un objet dans la scène ou ajoutez votre première
            primitive.
          </EmptyState>
          <Button icon={Plus} onClick={() => s.addPrimitive("cube")}>
            Ajouter un cube
          </Button>
        </div>
      )}
      <Section
        title="ENVIRONNEMENT"
        trailing={
          <IconButton
            icon={Settings2}
            label="Options de rendu"
            onClick={() => s.openDialog("render")}
          />
        }
      >
        <div className="environment-presets">
          {[
            { id: "studio" as const, name: "Studio" },
            { id: "sunset" as const, name: "Soleil" },
            { id: "night" as const, name: "Nuit" },
          ].map((env) => (
            <button
              key={env.id}
              className={`${env.id} ${document.render.environment === env.id ? "active" : ""}`}
              title={`Environnement HDRI ${env.name}`}
              onClick={() => s.setRender({ environment: env.id })}
            >
              <span className="env-preview" />
              <span>{env.name}</span>
              {document.render.environment === env.id && (
                <span className="env-active-dot" />
              )}
            </button>
          ))}
        </div>
        <RangeInput
          label="Exposition"
          min={0.1}
          max={3}
          value={document.render.exposure}
          onChange={(exposure) => s.setRender({ exposure })}
        />
        <Toggle
          label="Ombres en temps réel"
          value={document.render.shadows}
          onChange={(shadows) => s.setRender({ shadows })}
        />
        <button
          className="text-button more-render"
          onClick={() => s.openDialog("render")}
        >
          Tous les paramètres de rendu
          <Settings2 size={12} />
        </button>
      </Section>
      <div className="inspector-footnote">
        <span />
        Vos modifications sont annulables.<kbd>Ctrl Z</kbd>
      </div>
    </div>
  );
}
