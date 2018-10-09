export function wilsonLowerBound(nSuccess: number, n: number, z: number) {
    if (n === 0) {
        return 0;
    }

    const nFailure = n - nSuccess;
    const mean = (nSuccess + z * z / 2) / (n + z * z);
    const interval = (z / (n + z * z)) * Math.sqrt((nSuccess * nFailure) / n + (z * z / 4));
    return mean - interval;
}