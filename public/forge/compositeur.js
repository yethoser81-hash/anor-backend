// ==========================================
// ANOR V16 • Compositeur Géométrique Officiel
// ==========================================

const Compositeur = {
    composer(signatureMaitre, options = {}) {
        const glyphes = [];
        const rayons = [190, 150, 110];
        
        // Point d'ancrage et repérage supérieur (12H)
        glyphes.push({
            forme: 'anchor_start',
            rayon: 220,
            angle: -Math.PI / 2,
            plein: true
        });

        rayons.forEach((rayon, ringIdx) => {
            const count = 24 + ringIdx * 6;
            for (let i = 0; i < count; i++) {
                const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
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