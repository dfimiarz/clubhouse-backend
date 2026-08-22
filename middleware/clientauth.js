const {getAuth} = require('firebase-admin/auth')
const net = require('node:net')
const app = require('../firebaseadmin/firebaseadmin')
const RESTError = require('../utils/RESTError')
const { log, appLogLevels } = require('./../utils/logger/logger');
const authController = require('./../auth/controller');
const club_id = process.env.CLUB_ID;

const firebaseAuth = {
    verifyIdToken(token) {
        return getAuth(app).verifyIdToken(token)
    },
    getUser(uid) {
        return getAuth(app).getUser(uid)
    },
}

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
        if (!res.locals.username || res.locals.emailVerified !== true) {
            return next();
        }

        res.locals.role = await authController.getUserRole(res.locals.username, club_id);
        res.locals.userauth = shouldGrantRemoteUserAuth({
            emailVerified: res.locals.emailVerified,
            role: res.locals.role,
        });

        next();
    } catch (err) {
        log(appLogLevels.ERROR, `User role error: ${err.message} `);
        next(err);
    }
}

/**
 * Remote Firebase identity is only enough for authGuard when the email is
 * verified and the person has a live membership (including guest).
 *
 * @param {{ emailVerified?: boolean, role?: number|null }} identity
 * @returns {boolean}
 */
function shouldGrantRemoteUserAuth({ emailVerified, role } = {}) {
    return emailVerified === true && role != null;
}

/**
 * 
 * @param {Request} req Express Request object
 * @param {Response} res Express Response object
 * @param {next} next next functinon 
 */
async function checkUserAuth(req, res, next) {


    const token = parseBearerToken(req.headers.authorization);

    if (!token) {
        return next();
    }

    try {
        const decodedToken = await firebaseAuth.verifyIdToken(token);
        const uid = decodedToken.uid;
        const user = await firebaseAuth.getUser(uid);

        if (user.disabled) {
            return next(new RESTError(401, "Unable to verify auth token"));
        }

        res.locals.uid = uid;
        res.locals.username = user.email || decodedToken.email || null;
        res.locals.emailVerified = user.emailVerified === true;

        next()
    }
    catch (err) {
        log(appLogLevels.ERROR, `User token error: ${err}`)
        next(new RESTError(401, "Unable to verify auth token"));
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
 * Extract a Firebase ID token from an HTTP Authorization header.
 * Only the Bearer scheme is accepted (RFC 6750).
 *
 * @param {string|undefined} header
 * @returns {string|null}
 */
function parseBearerToken(header) {
    if (typeof header !== "string") {
        return null;
    }

    const match = /^Bearer[ \t]+(\S+)$/i.exec(header.trim());
    return match ? match[1] : null;
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

/**
 * Test hook. Pass null to restore the Firebase Admin client.
 *
 * @param {{ verifyIdToken?: Function, getUser?: Function }|null} overrides
 */
function _setFirebaseAuth(overrides) {
    if (!overrides) {
        firebaseAuth.verifyIdToken = (token) => getAuth(app).verifyIdToken(token);
        firebaseAuth.getUser = (uid) => getAuth(app).getUser(uid);
        return;
    }

    if (overrides.verifyIdToken) {
        firebaseAuth.verifyIdToken = overrides.verifyIdToken;
    }

    if (overrides.getUser) {
        firebaseAuth.getUser = overrides.getUser;
    }
}

module.exports = {
    checkUserAuth,
    checkGeoAuth,
    authGuard,
    checkUserRole,
    roleGuard,
    isTrustedProxySource,
    getGeoAuthState,
    parseBearerToken,
    shouldGrantRemoteUserAuth,
    _setFirebaseAuth,
}
