// Desc: Constants used in the application

module.exports = Object.freeze({
  ROLES: Object.freeze({
    ADMIN: 4000,
    MANAGER: 3000,
    PROFESSIONAL: 2500,
    MEMBER: 2000,
    JUNIOR: 1500,
    RETRICTED_MEMBER: 1000,
    GUEST: 500,
  }),
  ROLE_TYPES: Object.freeze({
    GUEST_TYPE: 100,
    RESTRICTED_MEMBER_TYPE: 200,
    MEMBER_TYPE: 300,
    INSTRUCTOR_TYPE: 350,
    MANAGER_TYPE: 400,
    SYSADMIN_TYPE: 1000,
  }),
});
