import { useRef, useState } from "react";
import { ImagePlus, RotateCcw, Settings2, Sun, Upload, X } from "lucide-react";
import { BACKGROUND_PRESETS, prepareBackground } from "../engine/background";
import { useEditor } from "../store/editor";
import {
  Button,
  ColorField,
  IconButton,
  RangeInput,
  Section,
  Toggle,
} from "./common";
import { chooseFiles, readAsDataURL } from "../services/bridge";

export function BackgroundPanel() {
  const render = useEditor((s) => s.document.render);
  const s = useEditor.getState();
  const input = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const upload = async (file: File) => {
    setLoading(true);
    try {
      const backgroundImage = await prepareBackground(file);
      s.setRender({ backgroundMode: "image", backgroundImage });
    } catch (e) {
      s.notify((e as Error).message, "error");
    } finally {
      setLoading(false);
    }
  };
  const hdr = async () => {
    try {
      const [file] = await chooseFiles(".hdr");
      if (!file) return;
      if (!/\.hdr$/i.test(file.name) || file.size > 32 * 1024 * 1024)
        throw new Error("Choisissez un HDR de 32 Mo maximum.");
      const hdri = await readAsDataURL(
        new Blob([file], { type: "image/vnd.radiance" }),
      );
      s.setRender({
        hdri,
        environment: "custom",
        backgroundMode: "environment",
      });
    } catch (e) {
      s.notify((e as Error).message, "error");
    }
  };
  return (
    <div className="background-panel inspector-scroll">
      <div className="simple-panel-intro">
        <h2>Le décor de votre création</h2>
        <p>Changez le fond sans modifier vos objets.</p>
      </div>
      <div className="background-types" role="group" aria-label="Type de fond">
        {(
          [
            { id: "color", label: "Couleur" },
            { id: "gradient", label: "Dégradé" },
            { id: "image", label: "Photo" },
            { id: "environment", label: "HDR" },
          ] as const
        ).map((type) => (
          <button
            key={type.id}
            aria-pressed={render.backgroundMode === type.id}
            className={render.backgroundMode === type.id ? "active" : ""}
            onClick={() => s.setRender({ backgroundMode: type.id })}
          >
            {type.label}
          </button>
        ))}
      </div>
      {["color", "gradient"].includes(render.backgroundMode) && (
        <>
          <div className="background-swatches">
            {BACKGROUND_PRESETS.map((preset) => (
              <button
                key={preset.name}
                title={`Fond ${preset.name}`}
                aria-label={`Fond ${preset.name}`}
                onClick={() =>
                  s.setRender({
                    background: preset.background,
                    backgroundEnd: preset.backgroundEnd,
                  })
                }
              >
                <span
                  style={{
                    background:
                      render.backgroundMode === "gradient"
                        ? `linear-gradient(${preset.background},${preset.backgroundEnd})`
                        : preset.background,
                  }}
                />
                <small>{preset.name}</small>
              </button>
            ))}
          </div>
          <ColorField
            label={
              render.backgroundMode === "gradient"
                ? "Couleur du haut"
                : "Couleur du fond"
            }
            value={render.background}
            onChange={(background) => s.setRender({ background })}
          />
          {render.backgroundMode === "gradient" && (
            <ColorField
              label="Couleur du bas"
              value={render.backgroundEnd}
              onChange={(backgroundEnd) => s.setRender({ backgroundEnd })}
            />
          )}
        </>
      )}
      {render.backgroundMode === "image" && (
        <>
          <div
            className={`background-upload ${dragging ? "dragging" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragging(false);
              const file = e.dataTransfer.files[0];
              if (file && !loading) void upload(file);
            }}
          >
            {render.backgroundImage ? (
              <img src={render.backgroundImage} alt="Fond personnalisé" />
            ) : (
              <ImagePlus size={30} />
            )}
            <button disabled={loading} onClick={() => input.current?.click()}>
              {loading
                ? "Préparation…"
                : render.backgroundImage
                  ? "Changer la photo"
                  : "Importer ou déposer une photo"}
            </button>
            <small>PNG, JPG, WebP · 20 Mo · cadrage automatique</small>
          </div>
          <input
            ref={input}
            className="sr-only"
            type="file"
            aria-label="Importer une image de fond"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
              e.target.value = "";
            }}
          />
          {render.backgroundImage && (
            <Button
              icon={X}
              onClick={() =>
                s.setRender({
                  backgroundImage: undefined,
                  backgroundMode: "gradient",
                })
              }
            >
              Retirer la photo
            </Button>
          )}
        </>
      )}
      {render.backgroundMode === "environment" && (
        <div className="information-card">
          <Sun size={17} />
          <p>
            Le panorama HDR sert de fond et d’éclairage. Le studio utilise une
            pièce virtuelle ; Soleil et Nuit sont des panoramas intégrés.
          </p>
        </div>
      )}
      <Section title="Éclairage" className="simple-lighting">
        <div className="environment-presets">
          {(
            [
              { id: "studio", name: "Studio" },
              { id: "sunset", name: "Soleil" },
              { id: "night", name: "Nuit" },
            ] as const
          ).map((env) => (
            <button
              key={env.id}
              aria-pressed={render.environment === env.id}
              className={`${env.id} ${render.environment === env.id ? "active" : ""}`}
              onClick={() => s.setRender({ environment: env.id })}
            >
              <span className="env-preview" />
              <span>{env.name}</span>
            </button>
          ))}
        </div>
        <RangeInput
          label="Luminosité"
          min={0.1}
          max={3}
          value={render.exposure}
          onChange={(exposure) => s.setRender({ exposure })}
        />
        <Toggle
          label="Ombres"
          value={render.shadows}
          onChange={(shadows) => s.setRender({ shadows })}
        />
        <Toggle
          label="Grille"
          value={render.grid}
          onChange={(grid) => s.setRender({ grid })}
        />
      </Section>
      <Section title="Réglages avancés" defaultOpen={false}>
        <RangeInput
          label="Rotation de l’environnement"
          min={-180}
          max={180}
          step={1}
          value={render.environmentRotation}
          onChange={(environmentRotation) =>
            s.setRender({ environmentRotation })
          }
        />
        <RangeInput
          label="Force de l’éclairage HDR"
          min={0}
          max={3}
          value={render.environmentIntensity}
          onChange={(environmentIntensity) =>
            s.setRender({ environmentIntensity })
          }
        />
        <Button icon={Upload} onClick={() => void hdr()}>
          Importer un panorama HDR
        </Button>
        <Button icon={Settings2} onClick={() => s.openDialog("render")}>
          Tous les réglages de rendu
        </Button>
      </Section>
      <button
        className="text-button background-reset"
        onClick={() =>
          s.setRender({
            backgroundMode: "gradient",
            background: "#25282b",
            backgroundEnd: "#444b55",
            environment: "studio",
            environmentRotation: 0,
            exposure: 1.15,
          })
        }
      >
        <RotateCcw size={13} />
        Revenir au studio
      </button>
      <p className="simple-hint">
        Fond enregistré dans le projet. <kbd>Ctrl Z</kbd> pour annuler.
      </p>
    </div>
  );
}
