/**
 * The selection→GraphQL-document lowering is parser-agnostic and shared by both
 * analyzers, so it now lives in the neutral query-build layer. This module is a
 * back-compat re-export for existing importers.
 * @see ../../../../../../query/build/lower-selection
 */
export * from '../../../../../../query/build/lower-selection'
