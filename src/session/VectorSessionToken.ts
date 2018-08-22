import * as BigInt from "big-integer";
import { isNumber } from "util";

/**
 * Models vector clock bases session token. Session token has the following format:
 * {Version}#{GlobalLSN}#{RegionId1}={LocalLsn1}#{RegionId2}={LocalLsn2}....#{RegionIdN}={LocalLsnN}
 * 'Version' captures the configuration number of the partition which returned this session token.
 * 'Version' is incremented everytime topology of the partition is updated (say due to Add/Remove/Failover).
 *
 * The choice of separators '#' and '=' is important. Separators ';' and ',' are used to delimit
 * per-partitionKeyRange session token
 * @hidden
 * @private
 *
 */
export class VectorSessionToken {
  private static readonly SEGMENT_SEPARATOR = "#";
  private static readonly REGION_PROGRESS_SEPARATOR = "=";

  constructor(
    private readonly version: number,
    private readonly globalLsn: number,
    private readonly localLsnByregion: Map<number, BigInt.BigInteger>,
    private readonly sessionToken?: string
  ) {
    if (!this.sessionToken) {
      const regionAndLocalLsn = [];
      for (const [key, value] of this.localLsnByregion.entries()) {
        regionAndLocalLsn.push(`${key}${VectorSessionToken.REGION_PROGRESS_SEPARATOR}${value}`);
      }
      const regionProgress = regionAndLocalLsn.join(VectorSessionToken.SEGMENT_SEPARATOR);
      if (regionProgress === "") {
        this.sessionToken = `${this.version}${VectorSessionToken.SEGMENT_SEPARATOR}${this.globalLsn}`;
      } else {
        this.sessionToken = `${this.version}${VectorSessionToken.SEGMENT_SEPARATOR}${this.globalLsn}${
          VectorSessionToken.SEGMENT_SEPARATOR
        }${regionProgress}`;
      }
    }
  }

  public static create(sessionToken: string): VectorSessionToken {
    if (!sessionToken) {
      return null;
    }

    const [versionStr, globalLsnStr, ...regionSegments] = sessionToken.split(VectorSessionToken.SEGMENT_SEPARATOR);

    const version = parseFloat(versionStr);
    const globalLsn = parseFloat(globalLsnStr);

    if (!isNumber(version) || !isNumber(globalLsn)) {
      return null;
    }

    const lsnByRegion = new Map<number, BigInt.BigInteger>();
    for (const regionSegment of regionSegments) {
      const [regionIdStr, localLsnStr] = regionSegment.split(VectorSessionToken.REGION_PROGRESS_SEPARATOR);

      if (!regionIdStr || !localLsnStr) {
        return null;
      }

      const regionId = parseInt(regionIdStr, 10);
      let localLsn: BigInt.BigInteger;
      try {
        localLsn = BigInt(localLsnStr);
      } catch (err) {
        // TODO: log error
        return null;
      }
      if (!isNumber(regionId)) {
        return null;
      }

      lsnByRegion.set(regionId, localLsn);
    }

    return new VectorSessionToken(version, globalLsn, lsnByRegion, sessionToken);
  }

  public equals(other: VectorSessionToken): boolean {
    return !other
      ? false
      : this.version === other.version &&
          this.globalLsn === other.globalLsn &&
          this.areRegionProgressEqual(other.localLsnByregion);
  }

  // TODO: Might not need this
  public isValid(other: VectorSessionToken): boolean {
    throw new Error("Not implemented");
  }

  public merge(other: VectorSessionToken): VectorSessionToken {
    if (other == null) {
      throw new Error("other (Vector Session Token) must not be null");
    }

    if (this.version === other.version && this.localLsnByregion.size !== other.localLsnByregion.size) {
      throw new Error(`Compared session tokens ${this.sessionToken} and ${other.sessionToken} have unexpected regions`);
    }

    const [higherVersionSessionToken, lowerVersionSessionToken]: [VectorSessionToken, VectorSessionToken] =
      this.version < other.version ? [other, this] : [this, other];

    const highestLocalLsnByRegion = new Map<number, BigInt.BigInteger>();

    for (const [regionId, highLocalLsn] of higherVersionSessionToken.localLsnByregion.entries()) {
      const lowLocalLsn = lowerVersionSessionToken.localLsnByregion.get(regionId);
      if (lowLocalLsn) {
        highestLocalLsnByRegion.set(regionId, BigInt.max(highLocalLsn, lowLocalLsn));
      } else if (this.version === other.version) {
        throw new Error(
          `Session tokens had same version, but different regions. Session 1: ${this.sessionToken} - Session 2: ${
            this.sessionToken
          }`
        );
      } else {
        highestLocalLsnByRegion.set(regionId, highLocalLsn);
      }
    }

    return new VectorSessionToken(
      Math.max(this.version, other.version),
      Math.max(this.globalLsn, other.globalLsn),
      highestLocalLsnByRegion
    );
  }

  public toString() {
    return this.sessionToken;
  }

  private areRegionProgressEqual(other: Map<number, BigInt.BigInteger>): boolean {
    if (this.localLsnByregion.size !== other.size) {
      return false;
    }

    for (const [regionId, localLsn] of this.localLsnByregion.entries()) {
      const otherLocalLsn = other.get(regionId);

      if (localLsn !== otherLocalLsn) {
        return false;
      }
    }
    return true;
  }
}