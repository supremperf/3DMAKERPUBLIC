# Contrats HTTP et commandes IA

Ces contrats décrivent les échanges réellement réalisés par 3DMAKER. L’application ne contient pas de serveur d’inférence factice. Le serveur temporaire dans `tests/browser/smoke.mjs` est une fixture d’intégration, sans utilisation par l’application distribuée.

## Passerelle personnalisée photo → 3D

Dans **Paramètres IA**, choisissez **API personnalisée** ou **Luma · passerelle**, puis l’URL complète de création de tâche. Exemple de serveur personnel : `http://localhost:8000/image-to-3d`. Cette URL est une convention configurable, pas une route Luma officielle supposée.

Les requêtes partent du processus Electron (ou du pont Vite en développement), et non directement du navigateur. Une clé renseignée est envoyée en `Authorization: Bearer …` uniquement au serveur du fournisseur configuré. Un serveur local peut fonctionner sans clé. Votre clé doit correspondre au mécanisme Bearer de votre passerelle ; les autres mécanismes d’authentification doivent être adaptés côté passerelle.

### Création

```http
POST /image-to-3d
Content-Type: application/json
```

Corps :

```json
{
  "image": "data:image/png;base64,...",
  "model": "nom-du-modele",
  "quality": "high",
  "target_polygons": 30000,
  "texture": true,
  "format": "glb"
}
```

`image` est un PNG ou JPEG préparé à 2048 px maximum. `quality` vaut `low`, `medium` ou `high`. La passerelle décide comment appliquer ces paramètres à son véritable moteur de reconstruction.

### Réponse synchrone

Une des formes suivantes :

- Corps GLB binaire, `Content-Type: model/gltf-binary`.
- Document GLTF JSON complet avec propriété `asset`, `Content-Type: model/gltf+json`.
- Objet JSON `{"model_url":"https://votre-service/modele.glb"}`.
- Objet JSON `{"model_base64":"BASE64_DU_GLB"}`.

Les réponses JSON doivent porter un type contenant `json`. Les GLTF possédant des buffers/images externes sont intégrés avant archivage : les URI relatives sont résolues par rapport à l’URL du modèle (ou à l’endpoint pour un retour GLTF direct), puis téléchargées par le backend. Pour éviter toute ambiguïté, un **GLB intégré** est recommandé. Les téléchargements d’assets n’envoient pas votre clé à une origine différente de celle du fournisseur configuré.

### Réponse asynchrone

Création :

```json
{ "id": "tache-123", "status": "queued", "progress": 0 }
```

3DMAKER consulte ensuite, toutes les quatre secondes :

```http
GET /image-to-3d/tache-123
```

En cours :

```json
{ "id": "tache-123", "status": "running", "progress": 42 }
```

Terminé :

```json
{
  "id": "tache-123",
  "status": "succeeded",
  "progress": 100,
  "model_url": "https://votre-service/modele.glb"
}
```

Échec :

```json
{
  "id": "tache-123",
  "status": "failed",
  "error": "La photo ne permet pas une reconstruction exploitable."
}
```

Alias compris : `task_id` ou `result` pour l’identifiant ; `state` pour le statut ; `model_urls.glb`, `model_urls.gltf`, `download_url`, `glb`, `assets.glb`, `assets.mesh`, `output.glb` ou `output.model_url` pour le modèle ; `task_error.message` pour l’erreur. `result` reste l’identifiant de tâche, conformément au retour de création Meshy, et non une URL arbitraire.

Le suivi local est limité à vingt minutes. Les erreurs et l’identifiant de tâche sont présentés à l’utilisateur. L’arrêt du suivi interrompt l’attente locale ; il **ne demande pas la suppression de la tâche distante**.

## Fournisseurs intégrés

### Meshy

- POST configurable, par défaut `https://api.meshy.ai/openapi/v1/image-to-3d`.
- Champs : `image_url`, `ai_model`, `topology: "triangle"`, `target_polycount`, `should_texture`, `enable_pbr`.
- Qualité : 35 %, 65 % ou 100 % de la cible, arrondie par centaine (minimum 100).
- Retour de création `{"result":"id"}` ; GET sur l’endpoint suivi de `/id`, lecture du statut/progress et des `model_urls`.

### Stability Fast 3D

- POST configurable, par défaut `https://api.stability.ai/v2beta/3d/fast-3d`.
- `multipart/form-data` : image binaire, `texture_resolution` 512/1024/2048, `remesh: triangle`, `vertex_count` dérivé de la cible de triangles.
- `Accept: model/gltf-binary`, retour binaire GLB.

L’existence d’un paramètre dans l’interface ne remplace pas les droits, quotas ou évolutions du contrat du fournisseur. Le modèle et l’URL restent configurables. Aucun résultat artificiel n’est substitué à une erreur de service.

## Assistant OpenAI-compatible, Claude et Venice

Configurez une URL de base, par exemple `https://api.openai.com/v1` ou `http://localhost:11434/v1`. Une URL se terminant par `/chat/completions` est également reconnue. **Détecter** utilise `GET /models`. **Tester l’IA** et la conversation utilisent `POST /chat/completions` : le premier vérifie une vraie réponse JSON `{ "message": "…", "actions": [] }`, sans action sur la scène, avec une limite réduite de tokens.

Le corps de conversation contient `model`, les messages et le contexte de scène (**300 objets maximum, sélection prioritaire**, mode de composants, réglages, transformations, matériaux, lumières/caméras et nombre de triangles). Les données binaires de fond/HDR ne sont pas incluses dans ce contexte textuel. Une capture JPEG **896 × 672**, `detail: "low"`, est jointe dans le message utilisateur lorsque la vision est activée. Ce message devient alors un tableau de blocs `text` et `image_url`, au format OpenAI. Le modèle doit accepter les images ; cette option est désactivée dans les préréglages locaux.

Les modèles standards reçoivent `temperature` et `max_tokens: 12000`. Pour les modèles de raisonnement **sur l’origine officielle OpenAI** identifiés `gpt-5` et suivants ou `o1/o3/o4`, la température est omise et le corps utilise `max_completion_tokens: 20000` ainsi que `reasoning_effort: high|medium|low`. Les serveurs compatibles personnalisés ne reçoivent pas automatiquement ces paramètres spécifiques à OpenAI. Si activé, `response_format: {"type":"json_object"}` impose un objet JSON. Le test utilise un effort faible et une limite réduite.

Les préréglages incluent OpenAI `gpt-6-sol` / `gpt-5.4-mini`, Claude natif (voir ci-dessous), Venice et les serveurs locaux Ollama / LM Studio. Les noms proposés ne garantissent ni l’accès du compte ni une qualité mesurée : la découverte et le test doivent vérifier le serveur réel. Aucun modèle de langage ni aucune clé n’est inclus. Le probe local interroge uniquement `http://127.0.0.1:11434/v1/models`, avec un délai de quatre secondes, sans en-tête de clé cloud.

Le serveur doit fournir `choices[0].message.content` comme **chaîne contenant un objet JSON** :

```json
{
  "message": "Je propose de rendre le cube en acier brossé rouge et d’ajouter une sphère bleue avec une lumière orange.",
  "actions": [
    {
      "type": "set_material",
      "target": "selection",
      "material": {
        "color": "#bb2211",
        "metalness": 1,
        "roughness": 0.3,
        "finish": "brushed"
      }
    },
    {
      "type": "create_primitive",
      "primitive": "sphere",
      "name": "Sphère bleue",
      "position": [3, 1, 0],
      "material": { "color": "#2266ff", "roughness": 0.08, "metalness": 0.1 }
    },
    {
      "type": "create_light",
      "lightType": "point",
      "name": "Lumière orange",
      "position": [3, -1, 0],
      "color": "#ff8800",
      "intensity": 8
    }
  ]
}
```

### Claude / Anthropic natif

Les paramètres `chat.protocol` valent `openai` ou `anthropic`. Les configurations anciennes gardent le format OpenAI, sauf si leur endpoint vise l’origine officielle Anthropic, qui migre vers le format natif sans perdre la clé. Le format peut aussi être choisi explicitement pour une passerelle personnalisée.

Les préréglages Claude Opus, Sonnet et Haiku utilisent `https://api.anthropic.com/v1`. Le backend envoie `x-api-key: <clé personnelle>` et `anthropic-version: 2023-06-01`, **pas** d’Authorization Bearer. La clé n’est jamais dans le corps de requête. Les contrôles d’origine et le refus des redirections s’appliquent aussi à Claude.

- Modèles : `GET /v1/models?limit=100`, pagination avec `after_id` et `last_id` / `has_more`, au plus dix pages. Les modèles `lifecycle: retired` sont exclus. Les capacités `image_input.supported` et la limite `max_tokens` sont lues si fournies.
- Inférence : `POST /v1/messages`. `system` est un champ séparé ; `messages` ne contient que des rôles user/assistant. `max_tokens` vaut au plus 12 000 pour un plan, 512 pour le test, réduit à la limite annoncée par le modèle si elle est connue. Les paramètres de température, de raisonnement et de format OpenAI ne sont pas transmis.
- Vision : un bloc `{ "type": "image", "source": { "type": "base64", "media_type": "image/jpeg", "data": "…" } }` puis le bloc de texte utilisateur. Seules les images intégrées sont acceptées par cet adaptateur.
- Mode JSON : un outil `proposer_plan_3dmaker` avec `input_schema` décrit `{message, actions}` ; `tool_choice` impose cet outil et désactive les outils parallèles. Le logiciel lit uniquement son `tool_use.input`, puis le soumet au même parseur et worker que les autres fournisseurs. **Ce n’est pas une exécution de code ni un accès arbitraire aux outils.** Tout autre outil ou plusieurs outils sont refusés.
- Sans mode structuré : les blocs `text` sont réunis et doivent toujours contenir le JSON de plan. Les blocs de raisonnement ne sont pas lus comme du contenu exécutable. Les refus et réponses tronquées (`max_tokens`) provoquent une erreur sans mutation.

Les modèles proposés `claude-opus-5-5`, `claude-sonnet-5-5` et `claude-haiku-5-5` figurent dans les types du SDK Anthropic consulté ; l’accès du compte et une inférence réussie restent à vérifier avec Détecter/Tester. Une clé API Anthropic distincte est nécessaire, pas simplement un abonnement Claude.

### Venice.ai

Le préréglage utilise **`https://api.venice.ai/api/v1`**, clé API Bearer personnelle et format OpenAI-compatible.

- Modèles : `GET /api/v1/models?type=text`. Seuls les modèles textuels non hors ligne sont retenus. Les champs `model_spec.capabilities.supportsVision`, `supportsResponseSchema`, `supportsReasoningEffort`, `reasoningEffortOptions`, `maxCompletionTokens` et `traits` sont pris en compte lorsqu’ils existent. Les capacités connues sont conservées cinq minutes en mémoire, sans aucune clé.
- Le modèle proposé `default` est un **trait Venice**, pas le nom d’un modèle inventé. Après découverte, l’interface propose le modèle concret du trait compatible avec les options demandées. Son accès doit encore être vérifié par inférence ; un catalogue public ne prouve pas la validité de la clé.
- Inférence : `POST /api/v1/chat/completions`, `max_completion_tokens` au plus 12 000 (1 500 pour le test), réduit à la limite publiée. Le mode JSON utilise `response_format: {type: "json_object"}` uniquement si activé. La vision conserve les blocs `image_url` OpenAI.
- `venice_parameters` : `include_venice_system_prompt: false`, `strip_thinking_response: true`, `enable_web_search: "off"`. Le test ajoute `disable_thinking: true` ; cette demande n’implique pas que tout raisonnement ni toute facturation est supprimé chez chaque modèle. L’effort configuré n’est envoyé que s’il figure dans les options déclarées par le catalogue.
- Un modèle explicitement sans vision/JSON structuré désactive ces options dans l’interface. Un texte JSON reste validé avant d’appliquer quoi que ce soit. `reasoning_content` n’est jamais interprété comme un plan. `content_filter`, un refus ou une réponse tronquée (`length`) provoquent une erreur sans mutation.

Ces intégrations concernent l’assistant de scène, pas une API neuronale photo → GLB. Tous les fournisseurs passent par la même validation locale, proposition, contrôle de scène obsolète et application atomique annulable.

### Références de contrat consultées

- [Types Messages Anthropic](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/resources/messages/messages.ts), [authentification/version](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/client.ts) et [Models](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/resources/models.ts).
- [Contrat chat Venice](https://github.com/veniceai/skills/blob/main/skills/venice-chat/SKILL.md) et [catalogue Models Venice](https://github.com/veniceai/skills/blob/main/skills/venice-models/SKILL.md).

Les contrats évoluent : ces références établissent la forme des requêtes et les noms proposés, **pas** une preuve d’inférence live, de disponibilité pour votre compte ou de qualité mesurée.

### Commandes autorisées

| `type`                             | Champs et effet                                                                                                                                                                                                |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_asset`                     | `asset` robot/castle/house/living-room/rocket/forest/vase/city, `name`, `size` 0.05–20, `position`, `color` ; vrais maillages de bibliothèque                                                                  |
| `layout`                           | `target`, `operation` ground/center ; pose au sol ou centrage du groupe en XZ                                                                                                                                  |
| `set_light`                        | `target`, `color`, `intensity`, `distance`, `angle`, `targetPoint`, `castShadow` ; cible lumière requise                                                                                                       |
| `set_camera`                       | `target`, `fov` 5–150, `targetPoint` ; cible caméra requise                                                                                                                                                    |
| `create_primitive`                 | `primitive` cube/sphere/cylinder/cone/torus/plane/tube/box, `name`, `position`, `rotation`, `scale`, `material`                                                                                                |
| `create_light`                     | `lightType` ambient/directional/point/spot, `name`, `position`, `color`, `intensity`, `distance`, `angle`, `targetPoint`, `castShadow`                                                                         |
| `create_camera`                    | `name`, `position`, `targetPoint`, `fov`                                                                                                                                                                       |
| `set_material`                     | `target`, `material` validé : couleur, rugosité, métal, émission, opacité, transmission, IOR, épaisseur, vernis, anisotropie, finition brushed/smooth, faces doubles, ombrage plat                             |
| `transform`                        | `target`, champs de transformation et `relative` ; addition de position/rotation et multiplication d’échelle en mode relatif                                                                                   |
| `rename` / `visibility` / `delete` | Cible et nom/visibilité, ou suppression d’objets non verrouillés                                                                                                                                               |
| `duplicate` / `array`              | Cible, `offset`, nombre 2–100 ; répétition radiale facultative autour de Y                                                                                                                                     |
| `boolean`                          | Deux `targets`, `operation` union/difference/intersection ; la différence retire B de A                                                                                                                        |
| `merge`                            | Au moins deux maillages, transformations appliquées                                                                                                                                                            |
| `mesh_operation`                   | extrude/bevel/subdivide/mirror/lathe/sweep/spin avec paramètres de l’opération, `faces` facultatives, `axis`, `center`, `path`                                                                                 |
| `render`                           | `backgroundMode` color/gradient/environment, `background`, `backgroundEnd`, `environmentRotation` −180..180, `environmentIntensity` 0..3, `grid`, `axes`, exposition, environnement intégré, ombres et filaire |

`target` : ID ou nom exact, `selection`, `all`, ou tableau de ces valeurs. Les cibles verrouillées sont exclues. Les distances sont en mètres et les rotations des actions en **degrés**, converties en radians dans le document. Les noms et vecteurs sont bornés. Les faces sélectionnées au moment de la demande sont utilisées pour une extrusion/Spin si aucune liste explicite n’est fournie.

Maximum 200 actions et 3 000 objets pour un plan. Les actions sont calculées dans un worker sur un instantané. Par défaut, la proposition attend **Appliquer le plan** ou **Ignorer** ; aucune modification n’est faite avant confirmation. L’identité du document est vérifiée après la réponse, après le calcul et au moment de l’application. Modifier la scène rend le plan périmé. Le mode d’application directe est optionnel (`chat.review: false`). **Tout le plan ou rien**, une entrée d’historique. Une simple réponse sans action ne crée pas une fausse modification. Le logiciel ne lance aucun code reçu du modèle.
