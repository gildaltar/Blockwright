# Texture-pack preview

The workbench reads textures locally; archives are not sent to the MCP server or chat.

1. Open the compiled build's workbench.
2. In `Textures`, choose `Load pack`.
3. Select a Java resource-pack `.zip`, Blockwright's locally generated vanilla resource ZIP, or the matching Minecraft client `.jar`.
4. Confirm the resolved material-state count. Missing mappings intentionally keep the procedural fallback.

Prefer a pack made for the build's exact Java version. The resolver follows blockstate variants, block-model parents, namespaced texture references, and common translucent textures. It approximates every placement as a full 1×1×1 cube; stairs, panes, doors, fences, emissive maps, connected textures, custom entity models, shaders, and engine light propagation are not geometric or lighting replicas.

Never request that the user send Mojang textures through chat. If they need vanilla assets, use `sync_java_version` with `includeTextures: true` so the assets are extracted locally from Mojang's verified client JAR.
