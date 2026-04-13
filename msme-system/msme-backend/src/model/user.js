'use strict';

const { Model, DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');

// ─── ROLES ────────────────────────────────────────────────────────────────────
// ADMIN       → full platform access: procurement lifecycle, KPIs, user mgmt
// SALES_STAFF → order intake, client management, invoicing
// FIELD_STAFF → delivery reconciliation, POD capture, on-site qty adjustment
// ─────────────────────────────────────────────────────────────────────────────

const ROLES = {
  ADMIN:       'admin',
  SALES_STAFF: 'sales_staff',
  FIELD_STAFF: 'field_staff',
};

const ROLE_LIST = Object.values(ROLES);

class User extends Model {
  // Instance method — compare plain password against stored hash
  async comparePassword(plainPassword) {
    return bcrypt.compare(plainPassword, this.passwordHash);
  }

  // Strip sensitive fields before sending to client
  toSafeJSON() {
    const { passwordHash, refreshTokenHash, ...safe } = this.toJSON();
    return safe;
  }

  static get ROLES() {
    return ROLES;
  }
}

User.init(
  {
    id: {
      type:          DataTypes.UUID,
      defaultValue:  DataTypes.UUIDV4,
      primaryKey:    true,
    },
    firstName: {
      type:      DataTypes.STRING(80),
      allowNull: false,
    },
    lastName: {
      type:      DataTypes.STRING(80),
      allowNull: false,
    },
    email: {
      type:      DataTypes.STRING(180),
      allowNull: false,
      unique:    true,
      validate:  { isEmail: true },
    },
    phone: {
      type:      DataTypes.STRING(20),
      allowNull: true,
    },
    passwordHash: {
      type:      DataTypes.STRING,
      allowNull: false,
    },
    role: {
      type:         DataTypes.ENUM(...ROLE_LIST),
      allowNull:    false,
      defaultValue: ROLES.SALES_STAFF,
    },
    isActive: {
      type:         DataTypes.BOOLEAN,
      defaultValue: true,
    },
    // Hashed refresh token stored server-side for rotation validation
    refreshTokenHash: {
      type:      DataTypes.STRING,
      allowNull: true,
    },
    // For password-reset flow
    resetPasswordToken: {
      type:      DataTypes.STRING,
      allowNull: true,
    },
    resetPasswordExpiry: {
      type:      DataTypes.DATE,
      allowNull: true,
    },
    lastLoginAt: {
      type:      DataTypes.DATE,
      allowNull: true,
    },
    createdBy: {
      type:      DataTypes.UUID,
      allowNull: true, // null = seeded or self-registered admin
    },
  },
  {
    sequelize:   require('../index'),  // sequelize instance — set up in database/index.js
    modelName:   'User',
    tableName:   'users',
    underscored: true,
    paranoid:    true, // soft-delete with deletedAt
    hooks: {
      // Hash password before create / update
      beforeCreate: async (user) => {
        if (user.passwordHash) {
          user.passwordHash = await bcrypt.hash(user.passwordHash, 12);
        }
      },
      beforeUpdate: async (user) => {
        if (user.changed('passwordHash')) {
          user.passwordHash = await bcrypt.hash(user.passwordHash, 12);
        }
      },
    },
  }
);

module.exports = { User, ROLES, ROLE_LIST };
