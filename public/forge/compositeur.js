/**
 * ==========================================================
 * public/forge/compositeur.js
 * ANOR V14
 * Moteur de composition géométrique des couches SVG,
 * intégrant les 3 couches, le logo, la zone de série et
 * le repère angulaire statique (point de départ de lecture).
 * ==========================================================
 */

class Compositeur {

    /**
     * Compose les glyphes et les instructions graphiques du sceau
     * @param {string} signature - Signature maître du produit
     * @param {Object} options - Options de composition (zoneSerie, etc.)
     * @returns {Array} Liste des glyphes générés avec leurs propriétés
     */
    static composer(signature, options = { zoneSerie: true }) {
        const layers = [100, 160, 215];
        const shapes = ['rect', 'circle', 'diamond', 'plus'];
        const glyphes = [];

        // Ajout du repère angulaire statique (point de départ de lecture fixe à l'angle 0)
        glyphes.push({
            forme: 'anchor_start',
            plein: true,
            anneau: 0,
            position: 250,
            angle: 0,
            rayon: 247
        });

        layers.forEach((radius, layerIndex) => {
            const numElements = (layerIndex === 0) ? 12 : 24;

            for (let i = 0; i < numElements; i++) {
                const angle = (i / numElements) * Math.PI * 2;
                // Indexation déterministe basée sur la signature pour la reproductibilité
                const shapeIndex = (signature.length + i + layerIndex) % shapes.length;
                const shapeType = shapes[shapeIndex];
                const isFilled = ((i + layerIndex) % 2 === 0);

                glyphes.push({
                    forme: shapeType,
                    plein: isFilled,
                    anneau: layerIndex + 1,
                    position: radius,
                    angle: angle,
                    rayon: radius
                });
            }
        });

        return glyphes;
    }
}

// Support pour Node.js et navigateur
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Compositeur;
}