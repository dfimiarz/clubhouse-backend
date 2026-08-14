import {transactionType, formatQuery, toFiniteNumber} from '../utils/dbutils.js'
import { expect } from "chai";

describe('dbutils test', () => {
    it('should return unmodified query', () => {
        const result = formatQuery("SELECT * FROM table", transactionType.NO_TRANSACTION);
        expect(result).to.equal("SELECT * FROM table");
    });

    it('should return query with LOCK IN SHARE MODE', () => {
        const result = formatQuery("SELECT * FROM table", transactionType.READ_TRANSACTION);
        expect(result).to.equal("SELECT * FROM table LOCK IN SHARE MODE");
    });

    it('should return query with FOR UPDATE', () => {
        const result = formatQuery("SELECT * FROM table", transactionType.WRITE_TRANSACTION);
        expect(result).to.equal("SELECT * FROM table FOR UPDATE");
    });
});

describe('toFiniteNumber', () => {
    it('adds after converting a mysql2 DECIMAL string', () => {
        expect(toFiniteNumber('1786718700.000000') + 300).to.equal(1786719000);
    });

    it('passes numbers through', () => {
        expect(toFiniteNumber(42)).to.equal(42);
    });

    it('returns NaN for garbage', () => {
        expect(Number.isNaN(toFiniteNumber('nope'))).to.equal(true);
    });
});
