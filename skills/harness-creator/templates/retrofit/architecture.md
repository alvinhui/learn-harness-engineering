# Architecture

> Long-term architectural constraints for agents. This is steering, not a
> tutorial: state the rules and boundaries that must not drift. Keep it current
> with the code — when they disagree, the code wins and this doc gets fixed.

## Overview

{{OVERVIEW}}

## Module Structure

{{MODULE_STRUCTURE}}

## Module Boundaries

Rules about what may depend on what:

{{MODULE_BOUNDARIES}}

## Public Contract

The surface that external callers depend on (changing it requires a version strategy):

{{PUBLIC_CONTRACT}}

## Dependency Rules

{{DEPENDENCY_RULES}}

## Test Requirements

What must have test coverage, and at what level:

{{TEST_REQUIREMENTS}}

## Change Admission Rules

Changes that are high-risk and require a spec/ADR before code:

{{CHANGE_ADMISSION}}
