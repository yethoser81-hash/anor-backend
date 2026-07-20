// ==========================================
// ANOR V16 • Compositeur Géométrique Structuré
// ==========================================

const Compositeur = {
    composer(signatureMaitre, options = {}) {
        const glyphes = [];
        // Rayons des orbites circulaires concentriques
        const rayons = [160, 135, 110]; 

        let sigIndex = 0;
        function getNextSeed() {
            if (!signatureMaitre) return Math.random();
            const charCode = signatureMaitre.charCodeAt(sigIndex % signatureMaitre.length);
            sigIndex++;
            return charCode / 255;
        }

        // Triangle de repérage haut (12H)
        glyphes.push({
            forme: 'anchor_top',
            rayon: 110,
            angle: -Math.PI / 2,
            plein: true
        });

        rayons.forEach((rayon, ringIdx) => {
            // Nombre de glyphes par anneau pour un espacement régulier et dense
            const count = 24 + ringIdx * 6; 
            
            for (let i = 0; i < count; i++) {
                const angle = (i / count) * Math.PI * 2 - Math.PI / 2;

                // Zone d'exclusion stricte pour le cartouche bas (laisser la place nette en bas)
                const normalizedAngle = (angle + Math.PI * 2) % (Math.PI * 2);
                const isBottomExclusionZone = (normalizedAngle > 0.7 && normalizedAngle < 2.44);

                if (isBottomExclusionZone && rayon >= 135) {
                    continue; 
                }

                // Choix déterministe de la forme sur la grille
                const seedForme = getNextSeed();
                const types = ['rect_long', 'rect_court', 'circle', 'diamond', 'square', 'plus'];
                const forme = types[Math.floor(seedForme * types.length)];
                
                // Alternance propre pilotée
                const plein = getNextSeed() > 0.4;

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