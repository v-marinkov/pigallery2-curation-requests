"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initConfig = exports.CurationConfig = void 0;
/* eslint-disable @typescript-eslint/no-inferrable-types */
require("reflect-metadata");
const SubConfigClass_1 = require("typeconfig/src/decorators/class/SubConfigClass");
const ConfigPropoerty_1 = require("typeconfig/src/decorators/property/ConfigPropoerty");
let CurationConfig = class CurationConfig {
    constructor() {
        this.databasePath = 'curation/curation.sqlite';
        this.reasonMaxLength = 4000;
        this.requesterAllowlist = '*';
    }
};
exports.CurationConfig = CurationConfig;
__decorate([
    (0, ConfigPropoerty_1.ConfigProperty)({
        tags: { name: 'Curation SQLite path' },
        description: 'Absolute path, or a path relative to PiGallery2 Database.dbFolder. Keep this on a persistent config/data volume.'
    }),
    __metadata("design:type", String)
], CurationConfig.prototype, "databasePath", void 0);
__decorate([
    (0, ConfigPropoerty_1.ConfigProperty)({
        tags: { name: 'Maximum reason length' },
        description: 'Maximum number of characters accepted for an optional deletion reason.'
    }),
    __metadata("design:type", Number)
], CurationConfig.prototype, "reasonMaxLength", void 0);
__decorate([
    (0, ConfigPropoerty_1.ConfigProperty)({
        tags: { name: 'Deletion request access' },
        description: 'Comma-separated access list. Use * for every authenticated user, admin for all administrators, or individual PiGallery2 usernames; for example: admin, family-user. Tokens are case-insensitive. Use user:admin for a non-administrator whose username is admin. Approval and decline remain administrator-only.'
    }),
    __metadata("design:type", String)
], CurationConfig.prototype, "requesterAllowlist", void 0);
exports.CurationConfig = CurationConfig = __decorate([
    (0, SubConfigClass_1.SubConfigClass)({ softReadonly: true })
], CurationConfig);
const initConfig = (extension) => {
    extension.setConfigTemplate(CurationConfig);
};
exports.initConfig = initConfig;
//# sourceMappingURL=config.js.map