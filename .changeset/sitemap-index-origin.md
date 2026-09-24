---
'@getcronit/pylon': patch
---

Fix: the sitemap **index** now advertises shard URLs on the configured `usePages({origin})`,
not the request `Host`.

`generateSitemaps` built shard URLs (`/sitemap/:id.xml`) from `baseUrl.origin` while the shard
and main-sitemap renderers already preferred `options.origin ?? baseUrl.origin`. So a sharded
sitemap's index leaked `localhost` in development, or — behind a proxy — whatever host an
attacker supplied. The index now uses the same origin the rest of the sitemap does.
