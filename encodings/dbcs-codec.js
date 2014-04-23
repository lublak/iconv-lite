
// Double-byte codec. This scheme is widespread and consists of 2 tables:
//  1. Single-byte: mostly just ASCII, but can be more complex.
//  2. Double-byte with leading byte not assigned in single-byte.

// To save memory, we read table files only when requested.

exports._dbcs = function(options, iconv) {
    if (!options)
        throw new Error("DBCS codec is called without the data.")
    if (!options.table)
        throw new Error("Encoding '" + options.type + "' has no data.");
    
    // Fill out DBCS -> Unicode decoding tables
    var decodeLead = [];
    for (var i = 0; i < 0x100; i++)
        decodeLead[i] = -1; // Unassigned.

    var decodeTable = [];
    for (var i = 0; i < 0x8000; i++)
        decodeTable[i] = -1; // Unassigned.

    if (!options.table.map) options.table = [options.table];
    for (var i = 0; i < options.table.length; i++) {
        var table = require(options.table[i]);
        for (var j = 0; j < table.length; j++) { // Chunks.
            var chunk = table[j];
            var curAddr = parseInt(chunk[0], 16), writeTable;
            
            if (curAddr < 0x100) {
                writeTable = decodeLead;
            }
            else if (curAddr < 0x10000) {
                if (decodeLead[curAddr >> 8] >= 0)
                    throw new Error("Overwrite lead byte in table " + options.table + ": " + chunk[0]);
                
                decodeLead[curAddr >> 8] = -2; // DBCS lead byte.
                writeTable = decodeTable;
                curAddr -= 0x8000;
                if (curAddr < 0)
                    throw new Error("DB address < 0x8000 in table " + options.table + ": " + chunk[0]);
            }
            else
                throw new Error("Unsupported address in table " + options.table + ": " + chunk[0]);

            for (var k = 1; k < chunk.length; k++) {
                var part = chunk[k];
                if (typeof part === "string") { // String, write as-is.
                    for (var l = 0; l < part.length; l++, curAddr++)
                        writeTable[curAddr] = part.charCodeAt(l);
                } 
                else if (typeof part === "number") { // Integer, meaning increasing sequence starting with prev character.
                    var charCode = writeTable[curAddr - 1] + 1;
                    for (var l = 0; l < part; l++, curAddr++)
                        writeTable[curAddr] = charCode++;
                }
                else
                    throw new Error("Incorrect value type '" + typeof part + "' in table " + options.table + ": " + chunk[0]);
            }
        }
    }

    // Unicode -> DBCS
    var encodeTable = [];
    for (var i = 0; i < 0x10000; i++)
        encodeTable[i] = -1; // Unassigned

    for (var i = 0; i < decodeTable.length; i++)
        if (decodeTable[i] >= 0)
            encodeTable[decodeTable[i]] = i + 0x8000;

    for (var i = 0; i < decodeLead.length; i++)
        if (decodeLead[i] >= 0)
            encodeTable[decodeLead[i]] = i;

    // Replace unassigned codes with default chars.
    var defCharUni = iconv.defaultCharUnicode.charCodeAt(0);
    for (var i = 0; i < decodeLead.length;  i++) if (decodeLead[i]  == -1) decodeLead[i]  = defCharUni;
    for (var i = 0; i < decodeTable.length; i++) if (decodeTable[i] == -1) decodeTable[i] = defCharUni;

    var defCharSB  = encodeTable[iconv.defaultCharSingleByte.charCodeAt(0)];
    if (defCharSB == -1) defCharSB = encodeTable['?'];
    if (defCharSB == -1) defCharSB = "?".charCodeAt(0);
    for (var i = 0; i < encodeTable.length; i++) if (encodeTable[i] == -1) encodeTable[i] = defCharSB;
    

    return {
        encode: encodeDBCS,
        decode: decodeDBCS,

        decodeLead: decodeLead,
        decodeTable: decodeTable,
        encodeTable: encodeTable,
    };
}

function encodeDBCS(str) {
    var newBuf = new Buffer(str.length*2), dbcsCode;

    for (var i = 0, j = 0; i < str.length; i++) {
        dbcsCode = this.encodeTable[str.charCodeAt(i)];
        if (dbcsCode < 0x100) {
            newBuf[j++] = dbcsCode;
        } else {
            newBuf[j++] = dbcsCode >> 8;   // high byte
            newBuf[j++] = dbcsCode & 0xFF; // low byte
        }
    }
    return newBuf.slice(0, j);
}

function decodeDBCS(buf) {
    var newBuf = new Buffer(buf.length*2), uCode, dbcsCode, lead;
    
    for (var i = 0, j = 0; i < buf.length; i++, j+=2) {
        dbcsCode = buf[i];
        lead = this.decodeLead[dbcsCode];
        if (lead >= 0)
            uCode = lead;
        else {
            dbcsCode = (dbcsCode << 8) + buf[++i];
            uCode = this.decodeTable[dbcsCode - 0x8000];
        }
        newBuf[j] = uCode & 0xFF; //low byte
        newBuf[j+1] = uCode >> 8; //high byte
    }
    return newBuf.slice(0, j).toString('ucs2');
}
