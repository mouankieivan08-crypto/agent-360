# Bibliothèque WhatsApp corrigée (temporaire)

`baileys-7.0.0-rc14-agent360.tgz` est Baileys compilé depuis le dépôt officiel
https://github.com/WhiskeySockets/Baileys, avec trois correctifs proposés par ses
contributeurs mais pas encore publiés sur npm. Depuis fin juillet 2026, WhatsApp
refuse la liaison d'un appareil (« Impossible de connecter ») avec la version publiée.

- base : `master` @ 0af2386292907f7d9742d8d41f830d8c48208fa1
- PR #2749 @ 38686677889a4db5356da51aa9517eb12c1e0866 : accusés de réception avant connexion
- PR #2602 @ ce25f9422a8e8c6cc027513534d924fd26f72619 : notification `link_code_companion_reg` sans données (connexion par code)
- PR #2765 @ 4f263f0e365c2e74dd1b824031d1c5910f518c26 : nouvelle étape `companion_reg_refresh` (connexion par QR code)

Dès qu'une version officielle intègre ces correctifs, remplace la dépendance dans
`package.json` par `"@whiskeysockets/baileys": "<version>"` et supprime ce dossier.
