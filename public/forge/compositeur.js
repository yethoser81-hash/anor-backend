// ==========================================
// ANOR V16 • Compositeur Géométrique Maîtrisé
// ==========================================

const Compositeur = {
    composer(signatureMaitre, options = {}) {
        const glyphes = [];
        const rayons = [160, 130, 100]; // Rayons resserrés et propres hors zone cartouche
        
        // Triangle de repérage positionné exactement sur le premier cercle interne au-dessus (12H)
        glyphes.push({
            forme: 'anchor_top',
            rayon: 100,
            angle: -Math.PI / 2,
            plein: true
        });

        rayons.forEach((rayon, ringIdx) => {
            const count = 18 + ringIdx * 4;
            for (let i = 0; i < count; i++) {
                const angle = (i / count) * Math.PI * 2 - Math.PI / 2;

                // ZONE D'EXCLUSION ABSOLUE DU CARTOUCHE BAS (entre 35° et 145° en partant du bas, soit angles bas)
                // On filtre pour interdire tout glyphe dans la zone sud (approximativement entre 0.6 rad et 2.5 rad)
                const normalizedAngle = (angle + Math.PI * 2) % (Math.PI * 2);
                const isBottomExclusionZone = (normalizedAngle > 0.8 && normalizedAngle < 2.34);

                if (isBottomExclusionZone && rayon >= 130) {
                    continue; // On saute les glyphes pour laisser un espace vide propre pour le cartouche
                }

                const types = ['rect_long', 'rect_court', 'circle', 'diamond', 'square'];
                const forme = types[i % types.length];
                const plein = (i % 2 === 0);

                glyphes.push({
                    forme,
                    rayon,
                    angle,
                    plein
                });
            }
        });

        return glyphes;
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Compositeur;
}