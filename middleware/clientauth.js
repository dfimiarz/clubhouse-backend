const {getAuth} = require('firebase-admin/auth')
const net = require('node:net')
const app = require('../firebaseadmin/firebaseadmin')
const RESTError = require('../utils/RESTError')
const { log, appLogLevels } = require('./../utils/logger/logger');
const { getUserRole } = require('./../auth/controller');
const club_id = process.env.CLUB_ID;

/**
 * 
 * @param {number|Array.<number>} roles A role id as a number or an array of role ids
 * 
 * @returns {function} Express middleware function
 */
function roleGuard(roles = []) { 

    //check if roles is a number
    if (typeof roles === 'number') {
        roles = [roles];
    }   

    return function (req, res, next) {

        //check if user has the required role
        if (!roles.includes(res.locals.role)) {
            return next(new RESTError(401, "Role not authorized"));
        }

        next();
    }

}

/**
 * 
 * @param {Request} req Request
 * @param {Response} res Response
 * @param {next} next next function
 */
async function checkUserRole(req, res, next) {

    try {
        if (!res.locals.username) {
            next();
        } else {

            res.locals.role = await getUserRole(res.locals.username, club_id);

            next();
        }
    } catch (err) {
        log(appLogLevels.ERROR, `User role error: ${err.message} `);
        next(new Error(`Unable to verify user role: ${err.message}`));
    }
}

/**
 * 
 * @param {Request} req Express Request object
 * @param {Response} res Express Response object
 * @param {next} next next functinon 
 */
async function checkUserAuth(req, res, next) {


    const token = getTokenFromHeaders(req);

    if (token) {

        try {
            const decodedToken = await getAuth(app).verifyIdToken(token);
            const uid = decodedToken.uid;

            const user = await getAuth(app).getUser(uid);
            res.locals.username = user.email;
            res.locals.userauth = true;

            next()
        }
        catch (err) {
            log(appLogLevels.ERROR, `User token error: ${err}`)
            next(new Error("Unable to verify auth token"));
        }
    }
    else {
        next();
    }



}

/**
 * 
 * @param {Request} req Express Request object
 * @param {Response} res Express Response object
 * @param {next} next next functinon 
 * 
 * Middleware checking if X-AUTH-CLIENT header is set. 
 * The header should be only set by proxy server to indicate client is accessing system for a authorized IP address
 * In nginx, geo module can set the header based on IP (http://nginx.org/en/docs/http/ngx_http_geo_module.html)
 */
function checkGeoAuth(req, res, next) {
    const geoAuthState = getGeoAuthState(req);

    if (geoAuthState.spoofed) {
        log(appLogLevels.ERROR, `Rejected spoofed trusted client header. Remote: ${geoAuthState.remoteAddress || "unknown"} IP: ${req.ip}`);
        return next(new RESTError(401, "Invalid trusted client header"));
    }

    res.locals.geoauth = geoAuthState.geoauth;

    next();
}

/**
 * 
 * @param {Request} req Express Request object 
 */
function getTokenFromHeaders(req) {

    const bearerHeader = req.headers['authorization'];

    if (bearerHeader) {
        const bearer = bearerHeader.split(' ');
        const bearerToken = bearer[1];
        return bearerToken;
    } else {
        return null;
    }
}

/**
 * 
 * @param {Request} req Express Request object
 * @param {Response} res Express Response object
 * @param {next} next next functinon 
 */
function authGuard(req, res, next) {
    if (!(res.locals.geoauth === true || res.locals.userauth === true)) {
        log(appLogLevels.ERROR, `Not authorized. IP: ${req.ip} `);
        next(new RESTError(401, "Not authorized"));
    }
    else {
        next();
    }
}

function getGeoAuthState(req) {
    const requested = req.header('X-AUTH-CLIENT') === "1";
    const remoteAddress = req.socket?.remoteAddress || req.connection?.remoteAddress || null;
    const trustedSource = isTrustedProxySource(remoteAddress);

    return {
        geoauth: requested && trustedSource,
        spoofed: requested && !trustedSource,
        requested,
        trustedSource,
        remoteAddress,
    };
}

function isTrustedProxySource(remoteAddress) {
    if (!remoteAddress || net.isIP(remoteAddress) === 0) {
        return false;
    }

    const normalizedAddress = remoteAddress.startsWith("::ffff:")
        ? remoteAddress.slice(7)
        : remoteAddress;

    if (normalizedAddress === "::1" || normalizedAddress === "127.0.0.1") {
        return true;
    }

    if (net.isIPv4(normalizedAddress)) {
        return normalizedAddress.startsWith("10.") ||
            normalizedAddress.startsWith("192.168.") ||
            /^172\.(1[6-9]|2\d|3[0-1])\./.test(normalizedAddress);
    }

    const loweredAddress = normalizedAddress.toLowerCase();
    return loweredAddress.startsWith("fc") ||
        loweredAddress.startsWith("fd") ||
        loweredAddress.startsWith("fe80:");
}

module.exports = { checkUserAuth, checkGeoAuth, authGuard, checkUserRole, roleGuard, isTrustedProxySource, getGeoAuthState }
