import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AnalyticsEvent, AnalyticsEventDocument, EventType } from '../../schemas/analytics.schema';

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectModel(AnalyticsEvent.name)
    private model: Model<AnalyticsEventDocument>,
  ) {}

  async getSummary(days = 7) {
    const since = new Date(Date.now() - days * 24 * 3600_000);

    const [volume, avgConf, langDist, channelDist] = await Promise.all([
      this.model.aggregate([
        { $match: { type: EventType.MESSAGE_SENT, createdAt: { $gte: since } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      this.model.aggregate([
        { $match: { type: EventType.MESSAGE_SENT, createdAt: { $gte: since } } },
        { $group: { _id: null, avg: { $avg: '$confidenceScore' } } },
      ]),
      this.model.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: '$language', count: { $sum: 1 } } },
      ]),
      this.model.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: '$channel', count: { $sum: 1 } } },
      ]),
    ]);

    return {
      volume,
      avgConfidence: Math.round((avgConf[0]?.avg ?? 0) * 100) / 100,
      languages: Object.fromEntries(langDist.map(r => [r._id, r.count])),
      channels: Object.fromEntries(channelDist.map(r => [r._id, r.count])),
    };
  }
}
