/**
 * ==========================================================
 * core/geometryIndex.js
 * ANOR V14
 * Moteur mathématique de normalisation, calcul des empreintes,
 * gestion du repère angulaire statique et hachage géométrique.
 * ==========================================================
 */

const crypto = require("crypto");

class GeometryIndex {

    /**
     * Construit et normalise la bibliothèque de formes et les empreintes géométriques.
     * @param {Array} glyphes - Liste des glyphes bruts issus du compositeur
     * @returns {Object} Objet contenant la version, le sha256, les préfixes et la bibliothèque ordonnée
     */
    static build(glyphes) {
        // Tri déterministe des glyphes par anneau puis par angle pour garantir l'invariance
        const glyphesTries = [...glyphes].sort((a, b) => {
            if (a.anneau !== b.anneau) return a.anneau - b.anneau;
            return a.angle - b.angle;
        });

        // Normalisation des propriétés géométriques pour l'indexation
        const bibliotheque = glyphesTries.map(g => ({
            forme: g.forme,
            plein: g.plein ? 1 : 0,
            anneau: g.anneau,
            position: Math.round(g.position * 1000) / 1000,
            angle: Math.round(g.angle * 100) / 100,
            rayon: Math.round(g.rayon * 100) / 100
        }));

        // Génération d'une chaîne représentative unique de la géométrie du sceau
        const rawString = JSON.stringify(bibliotheque);
        const sha256 = crypto.createHash("sha256").update(rawString).digest("hex");

        return {
            version: "V14",
            nombreGlyphes: bibliotheque.length,
            sha256: sha256,
            prefix16: sha256.substring(0, 16),
            prefix24: sha256.substring(0, 24),
            glyphes: bibliotheque
        };
    }

    /**
     * Extrait les index d'une empreinte sha256
     */
    static getIndexMetadata(sha256) {
        return {
            sha256: sha256,
            prefix16: sha256.substring(0, 16),
            prefix24: sha256.substring(0, 24)
        };
    }
}

module.exports = GeometryIndex;