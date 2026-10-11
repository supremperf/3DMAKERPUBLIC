import { useEffect, useState } from "react";
import {
  Box,
  Camera,
  Lightbulb,
  LoaderCircle,
  Plus,
  Search,
  Upload,
} from "lucide-react";
import { Modal } from "./Modal";
import { Button, PrimitiveIcon } from "./common";
import {
  ASSETS,
  createAsset,
  placeAlongside,
  type AssetId,
} from "../engine/library";
import { assetPreview } from "../engine/assetPreview";
import { useEditor } from "../store/editor";
import { primitiveNames, type Primitive } from "../types";
import { handleImport } from "../engine/io";
export function addLibraryAsset(id: AssetId, size = 1) {
  const s = useEditor.getState(),
    original = ASSETS.find((a) => a.id === id)!;
  const count = s.document.nodes.filter(
    (n) => n.name.startsWith(`${original.name} ·`) && n.name.includes(" · "),
  ).length;
  const name = count
    ? `${original.name} ${s.document.nodes.length + 1}`
    : original.name;
  try {
    s.addNodes(
      placeAlongside(createAsset(id, { size, name }), s.document.nodes),
      `Créer ${original.name}`,
    );
    s.focus("focus");
    s.openDialog(null);
    s.notify(`${original.name} ajouté : chaque pièce est éditable.`, "success");
  } catch (e) {
    s.notify((e as Error).message, "error");
  }
}
function AssetThumbnail({ id, name }: { id: AssetId; name: string }) {
  const [image, setImage] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(
      () => {
        if (!cancelled) {
          try {
            setImage(assetPreview(id));
          } catch {
            /* Sans WebGL, le titre reste accessible ; la vue affiche son erreur explicite. */
          }
        }
      },
      ASSETS.findIndex((a) => a.id === id) * 90,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id]);
  return image ? (
    <img src={image} alt={`Aperçu 3D de ${name}`} />
  ) : (
    <Box size={36} strokeWidth={1} aria-hidden="true" />
  );
}
export function CreationDialog() {
  const [tab, setTab] = useState<"shapes" | "library" | "lights">("shapes");
  const [query, setQuery] = useState("");
  const s = useEditor.getState();
  const add = (type: Primitive) => {
    s.addPrimitive(type);
    s.setTool("translate");
    s.focus("focus");
    s.openDialog(null);
  };
  return (
    <Modal
      title="Que voulez-vous créer ?"
      subtitle="Une forme, une composition ou votre propre modèle."
      icon={Plus}
      className="creation-modal"
      footer={
        <>
          <span className="modal-footer-hint">
            De vrais objets 3D. Toujours éditables et annulables.
          </span>
          <Button
            icon={Upload}
            onClick={() => {
              s.openDialog(null);
              void handleImport();
            }}
          >
            Importer un modèle
          </Button>
        </>
      }
    >
      <div className="dialog-tabs">
        <button
          className={tab === "shapes" ? "active" : ""}
          onClick={() => setTab("shapes")}
        >
          Formes
        </button>
        <button
          className={tab === "library" ? "active" : ""}
          onClick={() => setTab("library")}
        >
          Créations prêtes
        </button>
        <button
          className={tab === "lights" ? "active" : ""}
          onClick={() => setTab("lights")}
        >
          Lumières et caméra
        </button>
      </div>
      {tab === "shapes" && (
        <div className="creation-shapes primitives-grid">
          {(Object.keys(primitiveNames) as Primitive[]).map((type) => (
            <button
              className="creation-shape"
              key={type}
              onClick={() => add(type)}
            >
              <PrimitiveIcon type={type} size={32} />
              <strong>{primitiveNames[type]}</strong>
              <small>
                {type === "box"
                  ? "Boîte creuse"
                  : type === "tube"
                    ? "Courbe tubulaire"
                    : "Ajouter à la scène"}
              </small>
            </button>
          ))}
        </div>
      )}
      {tab === "library" && (
        <>
          <label className="library-search">
            <Search size={16} />
            <input
              aria-label="Rechercher une création"
              placeholder="Robot, maison, vase…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className="creation-library">
            {ASSETS.filter((a) =>
              `${a.name} ${a.category}`
                .toLocaleLowerCase("fr")
                .includes(query.toLocaleLowerCase("fr")),
            ).map((asset) => (
              <button
                className={`asset-card asset-${asset.id}`}
                key={asset.id}
                title={asset.description}
                onClick={() => addLibraryAsset(asset.id)}
              >
                <div className="asset-thumbnail">
                  <AssetThumbnail id={asset.id} name={asset.name} />
                </div>
                <span>
                  <strong>{asset.name}</strong>
                  <small>{asset.category}</small>
                  <Plus size={16} />
                </span>
              </button>
            ))}
          </div>
          {!ASSETS.some((a) =>
            `${a.name} ${a.category}`
              .toLocaleLowerCase("fr")
              .includes(query.toLocaleLowerCase("fr")),
          ) && (
            <p className="simple-hint">
              Aucune création ne correspond à cette recherche.
            </p>
          )}
          <p className="simple-hint">
            Bibliothèque procédurale locale : sans clé, sans téléchargement,
            sans génération IA simulée.
          </p>
        </>
      )}
      {tab === "lights" && (
        <div className="creation-lights">
          {(
            [
              {
                type: "ambient",
                label: "Ambiante",
                help: "Éclaire toute la scène",
              },
              {
                type: "directional",
                label: "Directionnelle",
                help: "Comme un soleil",
              },
              { type: "point", label: "Ponctuelle", help: "Comme une ampoule" },
              {
                type: "spot",
                label: "Projecteur",
                help: "Un faisceau orienté",
              },
            ] as const
          ).map((l) => (
            <button
              key={l.type}
              onClick={() => {
                s.addLight(l.type);
                s.openDialog(null);
              }}
            >
              <Lightbulb size={23} />
              <span>
                <strong>{l.label}</strong>
                <small>{l.help}</small>
              </span>
              <Plus size={17} />
            </button>
          ))}
          <button
            onClick={() => {
              s.addCamera();
              s.openDialog(null);
            }}
          >
            <Camera size={23} />
            <span>
              <strong>Caméra</strong>
              <small>Enregistrer un point de vue</small>
            </span>
            <Plus size={17} />
          </button>
        </div>
      )}
    </Modal>
  );
}
