import { useEffect, useState } from "react";
import { Vector3 } from "three";
import {
  Box,
  Camera,
  Copy,
  Eye,
  EyeOff,
  Lightbulb,
  Lock,
  MoveDown,
  Scan,
  Settings2,
  Trash2,
  Unlock,
} from "lucide-react";
import { useEditor } from "../store/editor";
import { useWorkspace } from "../store/workspace";
import { layoutNodes, worldBounds } from "../engine/library";
import { brushedNormalTexture } from "../engine/texturePresets";
import { DEFAULT_MATERIAL, type MaterialData, type Vec3 } from "../types";
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

export const SIMPLE_MATERIALS = [
  { name: "Argile", color: "#d6b698", roughness: 0.8, metalness: 0 },
  { name: "Plastique", color: "#a9c4dd", roughness: 0.28, metalness: 0 },
  { name: "Acier", color: "#bdc6d3", roughness: 0.3, metalness: 1 },
  { name: "Or", color: "#d6b668", roughness: 0.22, metalness: 1 },
  { name: "Verre", color: "#d8efeb", roughness: 0.04, metalness: 0 },
  { name: "Céramique", color: "#eeeadf", roughness: 0.17, metalness: 0 },
] as const;
export function materialPreset(
  name: (typeof SIMPLE_MATERIALS)[number]["name"],
): MaterialData {
  const preset = SIMPLE_MATERIALS.find((m) => m.name === name)!;
  return {
    ...structuredClone(DEFAULT_MATERIAL),
    color: preset.color,
    roughness: preset.roughness,
    metalness: preset.metalness,
    transmission: name === "Verre" ? 0.98 : 0,
    thickness: 0.2,
    clearcoat: name === "Céramique" ? 0.5 : 0,
    anisotropy: name === "Acier" ? 0.85 : 0,
    normalScale: name === "Acier" ? 0.35 : 1,
    textures: name === "Acier" ? { normalMap: brushedNormalTexture() } : {},
  };
}
export function SimpleInspector() {
  const doc = useEditor((s) => s.document),
    selection = useEditor((s) => s.selection);
  const s = useEditor.getState(),
    node = doc.nodes.find((n) => n.id === selection[0]);
  const [name, setName] = useState("");
  const [linked, setLinked] = useState(true);
  useEffect(() => setName(node?.name || ""), [node?.id, node?.name]);
  if (!node)
    return (
      <div className="simple-inspector inspector-scroll">
        <EmptyState icon={Box} title="Votre scène, à votre façon">
          Cliquez sur un objet pour le personnaliser, ou ajoutez une création.
        </EmptyState>
        <Button variant="primary" onClick={() => s.openDialog("create")}>
          Ajouter une création
        </Button>
      </div>
    );
  const locked = node.locked,
    multi = selection.length > 1;
  const patchMaterial = (patch: Partial<MaterialData>) =>
    s.patchSelected(
      (n) => (n.geometry ? { ...n, material: { ...n.material, ...patch } } : n),
      "Modifier l’apparence",
    );
  const transform = (
    field: "position" | "rotation" | "scale",
    axis: number,
    value: number,
  ) =>
    s.patchSelected((n) => {
      const vector = [...n.transform[field]] as Vec3;
      const safe =
        field === "scale" && Math.abs(value) < 0.0001
          ? value < 0
            ? -0.0001
            : 0.0001
          : value;
      if (field === "scale" && linked) {
        const ratio = safe / vector[axis];
        for (let i = 0; i < 3; i++) vector[i] *= ratio;
      } else vector[axis] = safe;
      return { ...n, transform: { ...n.transform, [field]: vector } };
    }, "Modifier la transformation");
  const layout = (operation: "ground" | "center") => {
    try {
      s.apply(
        operation === "ground" ? "Poser au sol" : "Centrer la sélection",
        (d) => {
          const nodes = layoutNodes(d.nodes, selection, operation);
          return nodes.every((n, i) => n === d.nodes[i]) ? d : { ...d, nodes };
        },
      );
    } catch (e) {
      s.notify((e as Error).message, "info");
    }
  };
  const bounds = node.geometry
    ? worldBounds(node).getSize(new Vector3())
    : null;
  const Icon = node.geometry ? Box : node.light ? Lightbulb : Camera;
  return (
    <div className="simple-inspector inspector-scroll">
      <div className="simple-object-heading">
        <span>
          <Icon size={22} />
        </span>
        <div>
          <h2>{multi ? `${selection.length} objets` : node.name}</h2>
          <p>
            {multi
              ? "Modifier la sélection"
              : node.geometry
                ? "Objet 3D éditable"
                : node.light
                  ? "Éclairage"
                  : "Caméra"}
          </p>
        </div>
        <IconButton
          icon={Scan}
          label="Cadrer cet objet (F)"
          onClick={() => s.focus("focus")}
        />
      </div>
      <div className="simple-name">
        <input
          aria-label="Nom de l’objet sélectionné"
          value={name}
          disabled={multi}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (name.trim() && name !== node.name)
              s.patchNode(node.id, { name: name.trim() }, "Renommer l’objet");
            else setName(node.name);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setName(node.name);
          }}
        />
        <IconButton
          icon={node.visible ? Eye : EyeOff}
          label={node.visible ? "Masquer l’objet" : "Afficher l’objet"}
          onClick={() =>
            s.patchNode(node.id, { visible: !node.visible }, "Visibilité")
          }
        />
        <IconButton
          icon={locked ? Lock : Unlock}
          active={locked}
          label={locked ? "Déverrouiller l’objet" : "Verrouiller l’objet"}
          onClick={() =>
            s.patchNode(node.id, { locked: !locked }, "Verrouillage")
          }
        />
      </div>
      {locked && (
        <p className="inline-note">
          <Lock size={12} />
          Déverrouillez l’objet pour le modifier.
        </p>
      )}
      {node.geometry && (
        <>
          <Section title="Apparence">
            <div className="simple-materials">
              {SIMPLE_MATERIALS.map((m) => (
                <button
                  key={m.name}
                  disabled={locked}
                  title={`Appliquer ${m.name}`}
                  onClick={() =>
                    s.patchSelected(
                      (n) =>
                        n.geometry
                          ? { ...n, material: materialPreset(m.name) }
                          : n,
                      `Matériau ${m.name}`,
                    )
                  }
                >
                  <span
                    className={m.name === "Verre" ? "glass" : ""}
                    style={{ "--swatch": m.color } as React.CSSProperties}
                  />
                  <small>{m.name}</small>
                </button>
              ))}
            </div>
            <ColorField
              label="Couleur"
              value={node.material.color}
              disabled={locked}
              onChange={(color) => patchMaterial({ color })}
            />
            <RangeInput
              label="Rugosité"
              value={node.material.roughness}
              disabled={locked}
              onChange={(roughness) => patchMaterial({ roughness })}
            />
          </Section>
          <div className="simple-object-actions">
            <Button
              icon={MoveDown}
              disabled={locked}
              onClick={() => layout("ground")}
            >
              Poser au sol
            </Button>
            <Button
              icon={Scan}
              disabled={locked}
              onClick={() => layout("center")}
            >
              Centrer
            </Button>
          </div>
        </>
      )}
      {node.light && (
        <Section title="Éclairage">
          <ColorField
            label="Couleur de la lumière"
            value={node.light.color}
            disabled={locked}
            onChange={(color) =>
              s.patchSelected(
                (n) => (n.light ? { ...n, light: { ...n.light, color } } : n),
                "Couleur de la lumière",
              )
            }
          />
          <RangeInput
            label="Intensité de la lumière"
            min={0}
            max={
              node.light.type === "ambient" || node.light.type === "directional"
                ? 10
                : 200
            }
            value={node.light.intensity}
            disabled={locked}
            onChange={(intensity) =>
              s.patchSelected(
                (n) =>
                  n.light ? { ...n, light: { ...n.light, intensity } } : n,
                "Intensité de la lumière",
              )
            }
          />
          <Toggle
            label="Projeter des ombres"
            value={node.light.castShadow}
            disabled={locked}
            onChange={(castShadow) =>
              s.patchSelected(
                (n) =>
                  n.light ? { ...n, light: { ...n.light, castShadow } } : n,
                "Ombres de la lumière",
              )
            }
          />
        </Section>
      )}
      {node.camera && (
        <Section title="Caméra">
          <RangeInput
            label="Champ de vision"
            min={5}
            max={150}
            value={node.camera.fov}
            disabled={locked}
            onChange={(fov) =>
              s.patchNode(
                node.id,
                { camera: { ...node.camera!, fov } },
                "Champ de vision",
              )
            }
          />
          <Button icon={Camera} onClick={() => s.focus("camera", node.id)}>
            Voir par cette caméra
          </Button>
        </Section>
      )}
      <Section title="Position et dimensions" defaultOpen={false}>
        {(
          [
            { field: "position", label: "Position" },
            { field: "rotation", label: "Rotation" },
            { field: "scale", label: "Échelle" },
          ] as const
        ).map(({ field, label }) => (
          <div className="vector-field" key={field}>
            <span className="field-label">{label}</span>
            <div className="vector-inputs">
              {node.transform[field].map((v, axis) => (
                <label key={axis} className="vector-component">
                  <span className={`axis-label axis-${["x", "y", "z"][axis]}`}>
                    {["X", "Y", "Z"][axis]}
                  </span>
                  <NumberInput
                    label={`${label} ${["X", "Y", "Z"][axis]}`}
                    value={field === "rotation" ? (v * 180) / Math.PI : v}
                    disabled={locked}
                    min={-10000}
                    step={field === "rotation" ? 1 : 0.1}
                    onChange={(value) =>
                      transform(
                        field,
                        axis,
                        field === "rotation" ? (value * Math.PI) / 180 : value,
                      )
                    }
                  />
                </label>
              ))}
            </div>
          </div>
        ))}
        <Toggle label="Échelle uniforme" value={linked} onChange={setLinked} />
        {bounds && (
          <p className="simple-hint">
            Dimensions : {bounds.x.toFixed(2)} × {bounds.y.toFixed(2)} ×{" "}
            {bounds.z.toFixed(2)} m
          </p>
        )}
      </Section>
      <div className="simple-object-actions">
        <Button icon={Copy} onClick={s.duplicateSelected}>
          Dupliquer
        </Button>
        <Button icon={Trash2} disabled={locked} onClick={s.deleteSelected}>
          Supprimer
        </Button>
      </div>
      <button
        className="simple-advanced-link"
        onClick={() => useWorkspace.getState().setExpert(true)}
      >
        <Settings2 size={14} />
        Tous les paramètres de l’objet
      </button>
      <p className="simple-hint">
        Toute modification est annulable. <kbd>Ctrl Z</kbd>
      </p>
    </div>
  );
}
