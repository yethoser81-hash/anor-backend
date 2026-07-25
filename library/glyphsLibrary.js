const GlyphsLibrary = {
    types: ['square', 'rect', 'circle', 'diamond', 'plus'],
    
    // Tailles encore augmentées pour un rendu visuel net et affirmé
    getGlyphDefinition(type) {
        switch(type) {
            case 'square':
                return { width: 18, height: 18, sides: 4 };
            case 'rect':
                // Rectangle étiré style barrette
                return { width: 36, height: 9, sides: 4 };
            case 'circle':
                return { width: 18, height: 18, radius: 9 };
            case 'diamond':
                return { width: 16, height: 16, rotation: 45 };
            case 'plus':
                return { width: 20, height: 20, symbol: '+' };
            default:
                return { width: 18, height: 18 };
        }
    },

    resolveGlyph(index) {
        return this.types[index % this.types.length];
    }
};

module.exports = GlyphsLibrary;