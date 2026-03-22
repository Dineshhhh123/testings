"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
const client_1 = require("@prisma/client");
exports.prisma = global.__prismaClient ??
    new client_1.PrismaClient({
        log: ['error', 'warn']
    });
if (process.env.NODE_ENV !== 'production') {
    global.__prismaClient = exports.prisma;
}
