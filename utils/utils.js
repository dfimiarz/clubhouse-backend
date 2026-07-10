function isAuthenticated(res){
    return res.locals.geoauth === true || res.locals.userauth === true;
}

function normalizeWhitespace(value) {
    return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : value;
}

function normalizeEmail(email) {
    return typeof email === "string" ? normalizeWhitespace(email).toLowerCase() : email;
}

function normalizePhone(phone) {
    return typeof phone === "string" ? normalizeWhitespace(phone) : phone;
}



module.exports = {
    isAuthenticated,
    normalizeWhitespace,
    normalizeEmail,
    normalizePhone,
}
