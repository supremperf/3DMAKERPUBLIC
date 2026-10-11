import { useEditor } from "../store/editor";
import { runGeometryJob } from "../engine/jobs";
import type { AssistantJobResult } from "../engine/calculations";
import { parseAssistantPlan, type AssistantPlan } from "./assistantPlan";
import { isChatConfigured, requestChatCompletion } from "./chatProviders";
import { viewport } from "../engine/ViewportEngine";
import { readAsDataURL } from "./bridge";
export { parseAssistantPlan, executePlan } from "./assistantPlan";
import type { ChatMessage, SceneDocument } from "../types";
import type { AISettings } from "../shared";

const systemPrompt = `Tu es l’assistant du logiciel de modélisation 3DMAKER. Réponds exclusivement par un objet JSON {"message":"explication du plan en français","actions":[...]}. Les actions sont exécutées dans une scène réelle. Ne retourne jamais de code JavaScript, de balises ou de commandes système. N’invente pas des capacités hors de la liste. Les distances sont en mètres, les rotations d’actions en degrés, Y est vertical. Un cube natif mesure 2 m par côté. Les noms doivent être uniques pour référencer les objets que tu crées. Tu peux proposer jusqu’à 200 actions, utiliser array pour créer des répétitions et des primitives pour construire une composition détaillée (château, meuble, véhicule). Les nouveaux objets doivent toucher le sol à Y=0. Utilise les objets sélectionnés quand la demande porte sur « cet objet ».
Cibles : target est un id ou nom exact, "selection" (par défaut), "all", ou un tableau de ces valeurs. Les objets verrouillés ne sont pas modifiables. Une action sur un nom créé précédemment est valide.
Actions autorisées :
- {type:"create_asset",asset:"robot|castle|house|living-room|rocket|forest|vase|city",name?,size:0.05..20,position:[x,y,z],color?:"#rrggbb"} : compositions locales détaillées et entièrement éditables. Préfère cette action pour les demandes correspondantes, puis complète avec primitives, matériaux et transformations.
- {type:"layout",target,operation:"ground|center"} : pose individuellement au sol, ou centre le groupe en XZ sans changer les distances.
- {type:"set_light",target,color?,intensity?,distance?,angle?,targetPoint?,castShadow?} ; {type:"set_camera",target,fov?,targetPoint?}
- {type:"create_primitive",primitive:"cube|sphere|cylinder|cone|torus|plane|tube|box",name,position:[x,y,z],rotation:[x,y,z],scale:[x,y,z],material:{color:"#rrggbb",roughness:0..1,metalness:0..1,emissive:"#rrggbb",emissiveIntensity:0..20,opacity:0..1,transmission:0..1,ior:1..2.333,thickness:0..10000,clearcoat:0..1,clearcoatRoughness:0..1,anisotropy:0..1,finish:"brushed|smooth",flatShading:boolean,doubleSided:boolean}}
- {type:"create_light",lightType:"ambient|directional|point|spot",name,position:[x,y,z],color:"#rrggbb",intensity:0..10000,distance:0..10000,angle:1..89,targetPoint:[x,y,z],castShadow:boolean}
- {type:"create_camera",name,position:[x,y,z],targetPoint:[x,y,z],fov:5..150}
- {type:"set_material",target,material:{champs de matériau ci-dessus}}
- {type:"transform",target,position?,rotation?,scale?,relative:boolean} : sans relative, remplace les champs fournis ; avec relative, additionne position/rotation et multiplie scale.
- {type:"rename",target,name} ; {type:"visibility",target,visible:boolean} ; {type:"delete",target} ; {type:"duplicate",target,offset:[x,y,z]}
- {type:"array",target,count:2..100,offset:[x,y,z],radial:boolean,angle:1..360} : count inclut l’objet original ; répétition circulaire autour de l’origine et de l’axe Y.
- {type:"boolean",targets:["id-ou-nom-A","id-ou-nom-B"],operation:"union|difference|intersection"} : remplace A et B, la différence retire B de A.
- {type:"merge",target} : fusionne au moins deux maillages.
- {type:"mesh_operation",target,operation:"extrude|bevel|subdivide|mirror|lathe|sweep|spin",amount:number,axis:"x|y|z",iterations:1..3,segments:8..128,angle:1..360,path:[[x,y,z],...],center:[x,y,z],faces?:[indices]}
- {type:"render",backgroundMode:"color|gradient|environment",backgroundEnd?:"#rrggbb",environmentRotation?:-180..180,environmentIntensity?:0..3,grid?:boolean,axes?:boolean,background:"#rrggbb",exposure:0.1..5,environment:"studio|sunset|night",shadows:boolean,wireframe:boolean}
La finition brushed crée une vraie normal map directionnelle et active l’anisotropie ; ajoute metalness:1, roughness:0.3 et la couleur souhaitée pour un acier brossé. Spin réalise une extrusion angulaire raccordée d’un profil plan ; une primitive plane utilise axis:"z" et center:[4,0,0]. Toutes les actions sont validées et proposées à l’utilisateur avant application en une transaction annulable. Ne prétends jamais qu’un changement est déjà appliqué. Construis avec soin : proportions, volumes secondaires, détails et matériau pour chaque pièce. Fais attention à la stabilité visuelle des compositions et aux objets existants. Avec une capture de la scène, utilise-la pour comprendre l’agencement, pas pour inventer des détails invisibles. Si tu ne peux pas réaliser la demande avec ces actions, explique pourquoi dans message et retourne actions:[] plutôt que promettre un résultat inexistant.`;
export interface AssistantProposal {
  before: SceneDocument;
  plan: AssistantPlan;
  result?: AssistantJobResult;
}
export async function prepareAssistant(
  input: string,
  messages: ChatMessage[],
  settings: AISettings,
  signal: AbortSignal,
): Promise<AssistantProposal> {
  if (!input.trim() || input.length > 8000)
    throw new Error("La demande doit contenir entre 1 et 8 000 caractères.");
  if (!isChatConfigured(settings.chat))
    throw new Error(
      "Connectez l’assistant : choisissez un service et ajoutez votre clé personnelle, ou démarrez Ollama sur cet ordinateur. Les créations de la bibliothèque fonctionnent sans IA.",
    );
  const before = useEditor.getState().document;
  const selection = [...useEditor.getState().selection];
  const editing = {
    mode: useEditor.getState().mode,
    components: [...useEditor.getState().components],
  };
  const context = JSON.stringify({
    editMode: useEditor.getState().mode,
    selectedComponents: useEditor.getState().components,
    selected: selection,
    render:
      before.render.backgroundImage || before.render.hdri
        ? { ...before.render, backgroundImage: undefined, hdri: undefined }
        : before.render,
    totalObjects: before.nodes.length,
    objects: [
      ...before.nodes.filter((n) => selection.includes(n.id)),
      ...before.nodes.filter((n) => !selection.includes(n.id)),
    ]
      .slice(0, 300)
      .map((n) => ({
        id: n.id,
        name: n.name,
        type: n.kind,
        locked: n.locked,
        transform: {
          ...n.transform,
          rotation: n.transform.rotation.map((v) => (v * 180) / Math.PI),
        },
        material: {
          color: n.material.color,
          roughness: n.material.roughness,
          metalness: n.material.metalness,
          transmission: n.material.transmission,
          anisotropy: n.material.anisotropy,
        },
        light: n.light,
        camera: n.camera,
        triangles: n.geometry
          ? (n.geometry.indices?.length || n.geometry.positions.length / 3) / 3
          : undefined,
      })),
  });
  let image: string | undefined;
  if (settings.chat.vision && viewport.get()) {
    const blob = await viewport
      .get()!
      .capture(896, 672, "image/jpeg", false, signal);
    image = await readAsDataURL(blob);
  }
  const content = await requestChatCompletion(
    settings,
    {
      system: `${systemPrompt}\nScène actuelle : ${context}`,
      messages: [
        ...messages
          .slice(-10)
          .map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: input },
      ],
      image,
    },
    signal,
  );
  const plan = parseAssistantPlan(content);
  if (useEditor.getState().document !== before)
    throw new Error(
      "La scène a changé pendant la réponse. Relancez votre demande pour éviter d’appliquer des actions à un contexte obsolète.",
    );
  if (!plan.actions.length) return { before, plan };
  const result = await runGeometryJob<AssistantJobResult>(
    { type: "assistant", document: before, selection, plan, context: editing },
    signal,
  );
  if (signal.aborted) throw new DOMException("Demande annulée.", "AbortError");
  if (useEditor.getState().document !== before)
    throw new Error(
      "La scène a changé pendant le calcul. Relancez votre demande.",
    );
  const original = new Map(before.nodes.map((n) => [n.id, n])),
    unchanged = new Set(result.unchangedIds),
    sameGeometry = new Set(result.sameGeometryIds);
  result.document.nodes = result.document.nodes.map((n) =>
    unchanged.has(n.id)
      ? original.get(n.id)!
      : sameGeometry.has(n.id)
        ? { ...n, geometry: original.get(n.id)?.geometry }
        : n,
  );
  if (JSON.stringify(result.document.render) === JSON.stringify(before.render))
    result.document.render = before.render;
  return { before, plan, result };
}
export function applyAssistantProposal(proposal: AssistantProposal): {
  message: string;
  actionCount: number;
} {
  const { before, plan, result } = proposal;
  if (useEditor.getState().document !== before)
    throw new Error(
      "La scène a changé depuis cette proposition. Redemandez un plan pour ne pas écraser vos modifications.",
    );
  if (!result) return { message: plan.message, actionCount: 0 };
  useEditor.getState().apply("Assistant IA", () => result.document);
  useEditor.setState({
    selection: result.selection,
    components: [],
    mode: "object",
  });
  if (
    plan.actions.some((a) => a.type.startsWith("create") || a.type === "array")
  )
    useEditor.getState().focus("all");
  return { message: plan.message, actionCount: plan.actions.length };
}
/** Compatibilité pour les intégrations qui demandent explicitement une application directe. */
export async function askAssistant(
  input: string,
  messages: ChatMessage[],
  settings: AISettings,
  signal: AbortSignal,
): Promise<{ message: string; actionCount: number }> {
  return applyAssistantProposal(
    await prepareAssistant(input, messages, settings, signal),
  );
}
