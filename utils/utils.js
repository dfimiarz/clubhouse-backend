const axios = require("axios");
const url = require('url');

async function verifyCaptcha(token) {

    const secretKey = process.env.RECAPTCHA_SECRET_KEY;
    const verifyUrl = `https://www.google.com/recaptcha/api/siteverify`;


    const params = new url.URLSearchParams({ secret: secretKey, response: token });


    const resp = await axios.post(verifyUrl, params.toString())



    return resp.data;
}

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
    verifyCaptcha,
    isAuthenticated,
    normalizeWhitespace,
    normalizeEmail,
    normalizePhone,
}
